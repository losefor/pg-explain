import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { runExplain } from "../../src/db/client.ts";
import { DEFAULT_EXPLAIN_FLAGS } from "../../src/db/explain.ts";
import { staleStatsFindings } from "../../src/diagnostics/stale-stats.ts";
import { analyze } from "../../src/index.ts";
import { liveLocks } from "../../src/locks/live.ts";
import { relationStats } from "../../src/server/schema.ts";

// CI sets the version matrix; locally default to one for a quick check.
const VERSIONS = (process.env.PGEXPLAIN_IT_PG_VERSIONS ?? process.env.PG_VERSIONS ?? "16")
  .split(",")
  .map((v) => v.trim());

describe.each(VERSIONS)("PostgreSQL %s (integration)", (version) => {
  let container: StartedTestContainer;
  let dsn: string;

  beforeAll(async () => {
    container = await new GenericContainer(`postgres:${version}-alpine`)
      .withEnvironment({ POSTGRES_USER: "test", POSTGRES_PASSWORD: "test", POSTGRES_DB: "test" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    dsn = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
  });

  afterAll(async () => {
    await container?.stop();
  });

  const connection = () => ({ dsn, connectTimeoutMs: 10_000 });

  it("connects, detects the version, and EXPLAINs a SELECT", async () => {
    const result = await runExplain({
      connection: connection(),
      statement: "SELECT g FROM generate_series(1, 1000) g ORDER BY g",
      flags: DEFAULT_EXPLAIN_FLAGS,
      statementTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
      forceWrite: false,
      rollback: true,
    });

    expect(result.caps.major).toBe(Number(version));
    // The plan parses and the advisor runs without throwing across every major.
    const analysis = analyze(result.json);
    expect(analysis.tree.hasAnalyze).toBe(true);
    expect(analysis.tree.root.metrics.selfMs).toBeGreaterThanOrEqual(0);
  });

  it("rolls back a --force mutation (no data is committed)", async () => {
    const setup = new pg.Client({ connectionString: dsn });
    await setup.connect();
    await setup.query("CREATE TABLE IF NOT EXISTS safety (n int)");
    await setup.query("TRUNCATE safety");

    await runExplain({
      connection: connection(),
      statement: "INSERT INTO safety VALUES (1), (2), (3)",
      flags: DEFAULT_EXPLAIN_FLAGS,
      statementTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
      forceWrite: true, // allowed to execute…
      rollback: true, // …but rolled back
    });

    const { rows } = await setup.query<{ count: string }>("SELECT count(*) FROM safety");
    expect(Number(rows[0]?.count)).toBe(0); // proven: nothing committed
    await setup.end();
  });

  it("reads pg_stat_user_tables and flags a never-analyzed table (PGX_STALE_STATISTICS)", async () => {
    const setup = new pg.Client({ connectionString: dsn });
    await setup.connect();
    await setup.query("CREATE TABLE IF NOT EXISTS churn (n int)");
    await setup.query("INSERT INTO churn SELECT generate_series(1, 5000)");
    await setup.end();

    // Verifies the pg_stat column names resolve on this major and the check fires.
    // Pre-15 the stats collector is async, so poll briefly until n_live_tup lands.
    let stats = await relationStats(connection(), ["churn"]);
    for (let i = 0; i < 20 && !(stats[0]?.liveTup ?? 0); i++) {
      await new Promise((r) => setTimeout(r, 500));
      stats = await relationStats(connection(), ["churn"]);
    }
    expect(stats).toHaveLength(1);
    expect(stats[0]?.liveTup).toBeGreaterThan(0);

    const findings = staleStatsFindings(stats, DEFAULT_CONFIG);
    expect(findings.some((f) => f.code === "PGX_STALE_STATISTICS")).toBe(true);
  });

  it("snapshots live locks and sees a real blocking chain", async () => {
    const holder = new pg.Client({ connectionString: dsn });
    const waiter = new pg.Client({ connectionString: dsn });
    await holder.connect();
    await waiter.connect();
    try {
      await holder.query("CREATE TABLE IF NOT EXISTS locked (n int)");
      await holder.query("INSERT INTO locked VALUES (1) ON CONFLICT DO NOTHING");
      await holder.query("BEGIN; LOCK TABLE locked IN ACCESS EXCLUSIVE MODE");
      const pending = waiter.query("SELECT * FROM locked"); // will queue behind the lock

      // Poll until pg_blocking_pids reflects the waiter.
      let snapshot = await liveLocks({ dsn, connectTimeoutMs: 10_000 }, Date.now());
      for (let i = 0; i < 20 && snapshot.blocked.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 250));
        snapshot = await liveLocks({ dsn, connectTimeoutMs: 10_000 }, Date.now());
      }

      expect(snapshot.blocked.length).toBeGreaterThan(0);
      expect(snapshot.blocked[0]?.blockedBy.length).toBeGreaterThan(0);

      await holder.query("ROLLBACK");
      await pending;
    } finally {
      await holder.end().catch(() => {});
      await waiter.end().catch(() => {});
    }
  });
});
