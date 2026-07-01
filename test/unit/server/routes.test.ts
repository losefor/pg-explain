import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config.ts";
import { createApp } from "../../../src/server/app.ts";
import { openStore } from "../../../src/server/store/sqlite.ts";

const plan = readFileSync(
  fileURLToPath(new URL("../../fixtures/seq-scan-large.json", import.meta.url)),
  "utf8",
);

let app: Hono;
beforeAll(() => {
  app = createApp({
    webRoot: "/nonexistent",
    store: openStore(":memory:"),
    config: DEFAULT_CONFIG,
  });
});

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// biome-ignore lint/suspicious/noExplicitAny: tests read dynamic JSON responses.
const json = (res: Response): Promise<any> => res.json();

describe("studio API routes", () => {
  it("GET /api/meta returns app metadata", async () => {
    const res = await app.request("/api/meta");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.app).toBe("pgexplain");
    expect(Array.isArray(body.formats)).toBe(true);
  });

  it("POST /api/analyze returns a report and saves history", async () => {
    const res = await post("/api/analyze", { plan });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.schemaVersion).toBe(1);
    expect(body.runId).toBeTruthy();
    expect(body.diagnostics.some((d: { code: string }) => d.code === "PGX_SEQ_SCAN_LARGE")).toBe(
      true,
    );

    const history = await json(await app.request("/api/history"));
    expect(history.runs.length).toBeGreaterThan(0);
  });

  it("POST /api/analyze accepts plain-text EXPLAIN and returns stats", async () => {
    const text = [
      "Nested Loop  (cost=0.29..16.32 rows=1 width=64) (actual time=0.045..0.052 rows=1 loops=1)",
      "  ->  Seq Scan on orders  (cost=0.00..8.00 rows=1 width=32) (actual time=0.02..0.03 rows=1 loops=1)",
      "        Filter: (id = 42)",
      "        Buffers: shared hit=4 read=2",
      "  ->  Index Scan using customers_pkey on customers  (cost=0.29..8.30 rows=1 width=32) (actual time=0.01..0.02 rows=1 loops=1)",
      "        Index Cond: (id = orders.customer_id)",
      "Execution Time: 0.210 ms",
    ].join("\n");
    const body = await json(await post("/api/analyze", { plan: text }));
    expect(body.schemaVersion).toBe(1);
    expect(body.summary.nodeCount).toBe(3);
    expect(body.summary.executionTimeMs).toBe(0.21);
    expect(body.stats.byNodeType.map((g: { key: string }) => g.key).sort()).toEqual([
      "Index Scan",
      "Nested Loop",
      "Seq Scan",
    ]);
    const seq = body.plan.children[0];
    expect(seq.relationName).toBe("orders");
    expect(seq.sharedHitBlocks).toBe(4);
  });

  it("POST /api/analyze with lock-relevant SQL adds lock findings", async () => {
    const body = await json(await post("/api/analyze", { plan, sql: "VACUUM FULL orders" }));
    expect(
      body.diagnostics.some((d: { code: string }) => d.code === "PGX_LOCK_TABLE_REWRITE"),
    ).toBe(true);
  });

  it("rejects an invalid body with a 400 Diagnostic", async () => {
    const res = await post("/api/analyze", {});
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("PGX_BAD_REQUEST");
    expect(body.error.remediation.summary.length).toBeGreaterThan(0);
  });

  it("rejects malformed plan JSON with a 422 parse Diagnostic", async () => {
    const res = await post("/api/analyze", { plan: "[{not json}]" });
    expect(res.status).toBe(422);
    expect((await json(res)).error.code).toBe("PGX_MALFORMED_JSON");
  });

  it("connections CRUD never leaks the password", async () => {
    const created = await json(
      await post("/api/connections", { name: "t", database: "feed", password: "secret" }),
    );
    expect(created.id).toBeTruthy();
    expect(created.hasPassword).toBe(true);
    expect("password" in created).toBe(false);

    const list = await json(await app.request("/api/connections"));
    expect(list.connections.some((c: { id: string }) => c.id === created.id)).toBe(true);

    const del = await app.request(`/api/connections/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("POST /api/diff compares two plans", async () => {
    const res = await post("/api/diff", { beforePlan: plan, afterPlan: plan });
    expect(res.status).toBe(200);
    expect((await json(res)).execDeltaMs).toBe(0); // same plan → no delta
  });
});
