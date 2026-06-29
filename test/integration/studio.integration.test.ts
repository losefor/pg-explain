import type { Hono } from "hono";
import pg from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { createApp } from "../../src/server/app.ts";
import { openStore } from "../../src/server/store/sqlite.ts";

const VERSIONS = (process.env.PGEXPLAIN_IT_PG_VERSIONS ?? process.env.PG_VERSIONS ?? "16")
  .split(",")
  .map((v) => v.trim());

describe.each(VERSIONS)("Studio API against PostgreSQL %s", (version) => {
  let container: StartedTestContainer;
  let app: Hono;
  let dsn: string;

  beforeAll(async () => {
    container = await new GenericContainer(`postgres:${version}-alpine`)
      .withEnvironment({ POSTGRES_USER: "test", POSTGRES_PASSWORD: "test", POSTGRES_DB: "test" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    dsn = `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;

    const setup = new pg.Client({ connectionString: dsn });
    await setup.connect();
    await setup.query("CREATE TABLE widget (id int primary key, name text)");
    await setup.query("CREATE INDEX widget_name ON widget(name)");
    await setup.query("INSERT INTO widget SELECT g, 'w' FROM generate_series(1, 500) g");
    await setup.query("ANALYZE widget");
    await setup.end();

    app = createApp({
      webRoot: "/nonexistent",
      store: openStore(":memory:"),
      config: DEFAULT_CONFIG,
    });
  });

  afterAll(async () => {
    await container?.stop();
  });

  // biome-ignore lint/suspicious/noExplicitAny: tests read dynamic JSON.
  const post = async (path: string, body: unknown): Promise<any> => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  it("POST /api/run analyzes a real EXPLAIN", async () => {
    const json = await post("/api/run", {
      connection: { dsn },
      sql: "SELECT * FROM widget ORDER BY name",
    });
    expect(json.schemaVersion).toBe(1);
    expect(json.summary.hasAnalyze).toBe(true);
    expect(json.server.major).toBe(Number(version));
  });

  it("POST /api/run refuses a non-SELECT (EXPLAIN-only safety)", async () => {
    const res = await app.request("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connection: { dsn }, sql: "UPDATE widget SET name = 'x'" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PGX_NON_SELECT_REFUSED");
  });

  it("POST /api/schema returns size/index/analyze stats", async () => {
    const json = await post("/api/schema", { connection: { dsn }, relations: ["widget"] });
    const w = json.relations.find((r: { relation: string }) => r.relation === "widget");
    expect(w.estRows).toBeGreaterThan(0);
    expect(w.indexes).toContain("widget_name");
    expect(w.lastAnalyze ?? w.lastAutoanalyze).toBeTruthy();
  });

  it("POST /api/locks/live returns a sessions snapshot", async () => {
    const json = await post("/api/locks/live", { connection: { dsn } });
    expect(Array.isArray(json.sessions)).toBe(true);
    expect(Array.isArray(json.blocked)).toBe(true);
  });
});
