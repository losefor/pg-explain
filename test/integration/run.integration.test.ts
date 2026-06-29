import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExplain } from "../../src/db/client.ts";
import { DEFAULT_EXPLAIN_FLAGS } from "../../src/db/explain.ts";
import { analyze } from "../../src/index.ts";

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
});
