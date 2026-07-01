import { Hono } from "hono";
import pkg from "../../../package.json" with { type: "json" };
import { analyzeScript } from "../../commands/script.ts";
import { DEFAULT_THRESHOLDS } from "../../config.ts";
import { diffAnalyses } from "../../core/diff.ts";
import { executionMs } from "../../core/metrics.ts";
import type { AnalysisResult, Severity } from "../../core/model.ts";
import { type ConnectionOptions, runExplain } from "../../db/client.ts";
import {
  DEFAULT_EXPLAIN_FLAGS,
  type ExplainFlags,
  isReadOnlyStatement,
  splitStatements,
} from "../../db/explain.ts";
import { opError } from "../../diagnostics/catalog.ts";
import { checkStaleStats } from "../../diagnostics/stale-stats.ts";
import { analyze } from "../../index.ts";
import { liveLocks } from "../../locks/live.ts";
import { buildReport, serializeNode } from "../../report/json.ts";
import { FORMATS, render } from "../../report/render.ts";
import { catalog, relationStats } from "../schema.ts";
import type { ConfigHolder } from "../settings.ts";
import { writeStudioConfig } from "../settings.ts";
import type { Store, ConnectionInput as StoredConnection } from "../store/sqlite.ts";
import {
  AnalyzeBodySchema,
  AnalyzeSqlBodySchema,
  CatalogBodySchema,
  ConnectionCreateSchema,
  type ConnectionInput,
  DiffBodySchema,
  ExportBodySchema,
  LiveLocksBodySchema,
  RunBodySchema,
  RunPatchSchema,
  SchemaBodySchema,
  SettingsBodySchema,
  validate,
} from "../validate.ts";

/** All `/api` routes. Each reuses the engine directly; errors become Diagnostics via app.onError. */
export function apiRoutes(store: Store, config: ConfigHolder): Hono {
  const api = new Hono();

  api.get("/api/meta", (c) =>
    c.json({
      app: "pgexplain",
      version: pkg.version,
      node: process.version,
      formats: FORMATS,
      defaults: { thresholds: DEFAULT_THRESHOLDS },
    }),
  );

  api.get("/api/health", (c) => c.json({ ok: true }));

  // Settings — current advisor config + persisting edits (written to the data dir).
  api.get("/api/settings", (c) => c.json(config.current));
  api.put("/api/settings", async (c) => {
    const body = validate(SettingsBodySchema, await c.req.json().catch(() => ({})));
    config.current = await writeStudioConfig(body as Parameters<typeof writeStudioConfig>[0]);
    return c.json(config.current);
  });

  // Analyze a pasted EXPLAIN JSON plan (no database needed).
  api.post("/api/analyze", async (c) => {
    const body = validate(AnalyzeBodySchema, await c.req.json().catch(() => ({})));
    const result = analyze(body.plan, {
      statement: body.statement,
      redact: body.redact,
      sql: body.sql,
      config: config.current,
    });
    const report = buildReport(result);
    const run = store.insertRun(
      saveFields("analyze", body.sql ?? null, null, result, report, body.plan),
    );
    return c.json({ ...report, runId: run.id });
  });

  // Connect, run EXPLAIN (EXPLAIN-only, rollback-wrapped), analyze.
  api.post("/api/run", async (c) => {
    const body = validate(RunBodySchema, await c.req.json().catch(() => ({})));
    const { connection, connectionId } = resolveConnection(
      store,
      body.connection,
      body.connectionId,
    );

    const statement = pickStatement(splitStatements(body.sql), body.statement);
    const flags: ExplainFlags = { ...DEFAULT_EXPLAIN_FLAGS, ...(body.flags ?? {}) };

    // Safety: refuse a data-modifying statement under ANALYZE unless explicitly forced.
    if (flags.analyze && !flags.genericPlan && !isReadOnlyStatement(statement) && !body.force) {
      const verb = statement.trim().split(/\s+/)[0]?.toUpperCase() ?? "statement";
      throw opError("PGX_NON_SELECT_REFUSED", {
        detail: `Refusing to ANALYZE a non-SELECT (${verb}) — it would modify data.`,
      });
    }

    const exec = await runExplain({
      connection,
      statement,
      params: body.params,
      flags,
      statementTimeoutMs: body.statementTimeoutMs ?? 30_000,
      lockTimeoutMs: body.lockTimeoutMs ?? 5_000,
      forceWrite: !!body.force,
      rollback: true,
    });

    const result = analyze(exec.json, {
      redact: body.redact,
      sql: statement,
      config: config.current,
    });
    await checkStaleStats(connection, result, config.current);
    const report = {
      ...buildReport(result),
      server: { major: exec.caps.major, omitted: exec.omitted },
    };
    const run = store.insertRun(
      saveFields("run", statement, connectionId, result, report, exec.json),
    );
    return c.json({ ...report, runId: run.id });
  });

  // Diff two plans — pasted (beforePlan/afterPlan) or two saved runs (beforeId/afterId).
  api.post("/api/diff", async (c) => {
    const body = validate(DiffBodySchema, await c.req.json().catch(() => ({})));
    const beforePlan = body.beforePlan ?? planTextOf(store, body.beforeId);
    const afterPlan = body.afterPlan ?? planTextOf(store, body.afterId);
    const before = analyze(beforePlan, { redact: body.redact });
    const after = analyze(afterPlan, { redact: body.redact });
    // Both trees ride along so the studio can render a side-by-side view.
    return c.json({
      ...diffAnalyses(before, after),
      beforePlan: serializeNode(before.tree.root),
      afterPlan: serializeNode(after.tree.root),
    });
  });

  // Export a report in a downloadable format (markdown / html / text / json).
  api.post("/api/export", async (c) => {
    const body = validate(ExportBodySchema, await c.req.json().catch(() => ({})));
    const planText = body.plan ?? planTextOf(store, body.runId);
    const result = analyze(planText, { redact: body.redact, sql: body.sql });
    const content = render(result, { format: body.format });
    const types: Record<string, string> = {
      markdown: "text/markdown",
      html: "text/html",
      text: "text/plain",
      json: "application/json",
    };
    return c.body(content, 200, { "Content-Type": `${types[body.format]}; charset=utf-8` });
  });

  // Full table/column catalog for editor autocomplete + the schema explorer.
  api.post("/api/catalog", async (c) => {
    const body = validate(CatalogBodySchema, await c.req.json().catch(() => ({})));
    const { connection } = resolveConnection(store, body.connection, body.connectionId);
    return c.json({ tables: await catalog(connection) });
  });

  // Schema/stats enrichment — size, indexes, vacuum/analyze freshness for relations.
  api.post("/api/schema", async (c) => {
    const body = validate(SchemaBodySchema, await c.req.json().catch(() => ({})));
    const { connection } = resolveConnection(store, body.connection, body.connectionId);
    return c.json({ relations: await relationStats(connection, body.relations) });
  });

  // Safely analyze a DO block / multi-statement script / write — cost-only, never executes.
  api.post("/api/analyze-sql", async (c) => {
    const body = validate(AnalyzeSqlBodySchema, await c.req.json().catch(() => ({})));
    const { connection } = resolveConnection(store, body.connection, body.connectionId);
    const analysis = await analyzeScript(connection, body.sql, {
      config: config.current,
      redact: body.redact,
      statementTimeoutMs: 30_000,
      lockTimeoutMs: 5_000,
    });
    return c.json({
      executed: false,
      serverMajor: analysis.serverMajor ?? null,
      units: analysis.units.map((u) => ({
        label: u.label,
        status: u.status,
        loopNote: u.loopNote ?? null,
        report: u.report ?? null,
        reason: u.reason ?? null,
        errorCode: u.errorCode ?? null,
      })),
    });
  });

  // Live lock contention — the one thing EXPLAIN can't show.
  api.post("/api/locks/live", async (c) => {
    const body = validate(LiveLocksBodySchema, await c.req.json().catch(() => ({})));
    const { connection } = resolveConnection(store, body.connection, body.connectionId);
    return c.json(await liveLocks(connection, Date.now()));
  });

  // ── history ──────────────────────────────────────────────────────────────
  api.get("/api/history", (c) => c.json({ runs: store.listRuns() }));
  api.get("/api/history/:id", (c) => {
    const run = store.getRun(c.req.param("id"));
    return run
      ? c.json(run)
      : c.json({ error: { code: "PGX_NOT_FOUND", title: "No such run" } }, 404);
  });
  api.delete("/api/history/:id", (c) =>
    store.deleteRun(c.req.param("id"))
      ? c.json({ ok: true })
      : c.json({ error: { code: "PGX_NOT_FOUND" } }, 404),
  );
  api.patch("/api/history/:id", async (c) => {
    const patch = validate(RunPatchSchema, await c.req.json().catch(() => ({})));
    const run = store.updateRun(c.req.param("id"), patch);
    return run ? c.json(run) : c.json({ error: { code: "PGX_NOT_FOUND" } }, 404);
  });

  // ── connections ────────────────────────────────────────────────────────────
  api.get("/api/connections", (c) => c.json({ connections: store.listConnections() }));
  api.post("/api/connections", async (c) => {
    const input = validate(ConnectionCreateSchema, await c.req.json().catch(() => ({})));
    return c.json(store.createConnection(input), 201);
  });
  api.put("/api/connections/:id", async (c) => {
    const input = validate(ConnectionCreateSchema, await c.req.json().catch(() => ({})));
    const updated = store.updateConnection(c.req.param("id"), input);
    return updated ? c.json(updated) : c.json({ error: { code: "PGX_NOT_FOUND" } }, 404);
  });
  api.delete("/api/connections/:id", (c) =>
    store.deleteConnection(c.req.param("id"))
      ? c.json({ ok: true })
      : c.json({ error: { code: "PGX_NOT_FOUND" } }, 404),
  );

  return api;
}

/** Inline connection wins; else load a saved one by id (with its stored password). */
function resolveConnection(
  store: Store,
  inline: ConnectionInput | undefined,
  connectionId: string | undefined,
): { connection: ConnectionOptions; connectionId: string | null } {
  if (inline) return { connection: toConnectionOptions(inline), connectionId: null };
  if (connectionId) {
    const saved = store.getConnection(connectionId);
    if (!saved)
      throw opError("PGX_EMPTY_INPUT", { detail: `No saved connection ${connectionId}.` });
    return { connection: toConnectionOptions(saved), connectionId };
  }
  throw opError("PGX_EMPTY_INPUT", { detail: "Provide a connection or a connectionId." });
}

function toConnectionOptions(input: ConnectionInput | StoredConnection): ConnectionOptions {
  const c: ConnectionOptions = {
    connectTimeoutMs: ("connectTimeoutMs" in input && input.connectTimeoutMs) || 10_000,
  };
  if (input.dsn) c.dsn = input.dsn;
  if (input.host) c.host = input.host;
  if (input.port) c.port = input.port;
  if (input.database) c.database = input.database;
  if (input.user) c.user = input.user;
  if ("password" in input && input.password) c.password = input.password;
  if (input.sslmode) c.sslmode = input.sslmode;
  if (input.sslrootcert) c.sslrootcert = input.sslrootcert;
  return c;
}

function saveFields(
  kind: "analyze" | "run",
  sql: string | null,
  connectionId: string | null,
  result: AnalysisResult,
  report: Record<string, unknown>,
  planText: string,
) {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const d of result.diagnostics) counts[d.severity]++;
  return {
    kind,
    sql,
    connectionId,
    planText,
    verdict: result.verdict,
    worstSeverity: result.worstSeverity,
    execMs: executionMs(result.tree) ?? null,
    counts,
    report,
  };
}

/** Resolve a saved run's raw plan text for a diff-by-id, or fail clearly. */
function planTextOf(store: Store, id: string | undefined): string {
  if (!id)
    throw opError("PGX_EMPTY_INPUT", {
      detail: "Provide beforePlan/afterPlan or beforeId/afterId.",
    });
  const run = store.getRun(id);
  if (!run?.planText) {
    throw opError("PGX_EMPTY_INPUT", { detail: `Run ${id} has no stored plan to diff.` });
  }
  return run.planText;
}

function pickStatement(statements: string[], index?: number): string {
  if (statements.length === 0)
    throw opError("PGX_EMPTY_INPUT", { detail: "No SQL statement found." });
  if (index !== undefined) {
    const stmt = statements[index - 1];
    if (!stmt) {
      throw opError("PGX_MULTIPLE_STATEMENTS", {
        detail: `statement ${index} is out of range; found ${statements.length}.`,
      });
    }
    return stmt;
  }
  if (statements.length > 1) {
    throw opError("PGX_MULTIPLE_STATEMENTS", {
      detail: `Found ${statements.length} statements; pass a 1-based "statement" index.`,
    });
  }
  return statements[0] as string;
}
