import { readFile } from "node:fs/promises";
import type { Client, ClientConfig } from "pg";
import type { Diagnostic } from "../core/model.ts";
import { opError } from "../diagnostics/catalog.ts";
import { AppError } from "../diagnostics/diagnostic.ts";
import { logVerbose } from "../util/log.ts";
import { buildExplain, type ExplainFlags } from "./explain.ts";
import { capabilities, type ServerCapabilities } from "./version.ts";

export interface ConnectionOptions {
  dsn?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Prefer PGPASSWORD/.pgpass; this exists for completeness. */
  password?: string;
  /** disable | require | verify-ca | verify-full */
  sslmode?: string;
  sslrootcert?: string;
  connectTimeoutMs: number;
}

export interface RunOptions {
  connection: ConnectionOptions;
  statement: string;
  params?: string[];
  flags: ExplainFlags;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  /** Allow a non-SELECT to actually execute (still rolled back). */
  forceWrite: boolean;
  /** Keep the BEGIN…ROLLBACK wrapper (default true; almost never turn off). */
  rollback: boolean;
}

export interface RunResult {
  /** The EXPLAIN (FORMAT JSON) output, serialized to text for the parser. */
  json: string;
  caps: ServerCapabilities;
  /** Options dropped under --compat. */
  omitted: string[];
}

// ── lazy pg loader ────────────────────────────────────────────────────────────

async function newClient(config: ClientConfig): Promise<Client> {
  let mod: typeof import("pg");
  try {
    mod = await import("pg");
  } catch (err) {
    throw opError("PGX_PG_DRIVER_MISSING", {}, err);
  }
  // pg is CJS; the Client constructor is on the default export (or the namespace).
  // biome-ignore lint/suspicious/noExplicitAny: CJS/ESM interop for the optional driver.
  const lib: any = (mod as any).default ?? mod;
  return new lib.Client(config) as Client;
}

function buildClientConfig(c: ConnectionOptions, ca?: string): ClientConfig {
  const config: ClientConfig = { connectionTimeoutMillis: c.connectTimeoutMs };

  if (c.dsn) {
    config.connectionString = c.dsn;
  } else {
    // Leave fields undefined so pg falls back to PG* env vars and ~/.pgpass.
    if (c.host) config.host = c.host;
    if (c.port) config.port = c.port;
    if (c.database) config.database = c.database;
    if (c.user) config.user = c.user;
    if (c.password) config.password = c.password;
  }

  if (c.sslmode && c.sslmode !== "disable" && c.sslmode !== "prefer") {
    const verify = c.sslmode === "verify-ca" || c.sslmode === "verify-full";
    config.ssl = ca ? { rejectUnauthorized: verify, ca } : { rejectUnauthorized: verify };
  } else if (c.sslmode === "disable") {
    config.ssl = false;
  }

  return config;
}

/**
 * Connect, run EXPLAIN inside a guarded, auto-rolled-back transaction, and return
 * the plan JSON. Safety guarantees:
 *   BEGIN → SET LOCAL statement_timeout / lock_timeout → (read-only unless --force)
 *   → EXPLAIN … → ROLLBACK (always; an EXPLAIN never needs to commit).
 * The pool is always torn down. All errors become actionable AppErrors.
 */
export async function runExplain(opts: RunOptions): Promise<RunResult> {
  const ca = opts.connection.sslrootcert
    ? await readFile(opts.connection.sslrootcert, "utf8").catch((err) => {
        throw opError("PGX_SSL_VERIFY_FAILED", {
          detail: `Could not read --sslrootcert '${opts.connection.sslrootcert}': ${err instanceof Error ? err.message : String(err)}`,
        });
      })
    : undefined;

  const client = await newClient(buildClientConfig(opts.connection, ca));

  try {
    await client.connect();
  } catch (err) {
    throw mapConnectError(err);
  }

  try {
    const verNum = await fetchVersionNum(client);
    const caps = capabilities(verNum);
    const built = buildExplain(opts.flags, caps);
    const explainSql = `${built.prefix} ${opts.statement}`;
    logVerbose(`server_version_num=${verNum}; ${built.prefix}`);

    const useTxn = opts.rollback;
    if (useTxn) await client.query("BEGIN");
    try {
      if (useTxn) {
        await client.query(`SET LOCAL statement_timeout = ${msInt(opts.statementTimeoutMs)}`);
        await client.query(`SET LOCAL lock_timeout = ${msInt(opts.lockTimeoutMs)}`);
        if (!opts.forceWrite) await client.query("SET LOCAL transaction_read_only = on");
      }
      const res = await client.query<{ "QUERY PLAN": unknown }>({
        text: explainSql,
        values: opts.params ?? [],
      });
      return { json: extractPlanJson(res.rows), caps, omitted: built.omitted };
    } catch (err) {
      throw mapQueryError(err);
    } finally {
      if (useTxn) await client.query("ROLLBACK").catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

function msInt(ms: number): number {
  return Math.max(0, Math.floor(ms));
}

/**
 * Connect, run a single read-only SELECT under a statement_timeout, and return its
 * rows. Used for live-lock introspection and schema/stats lookups (never mutates).
 */
export async function queryReadOnly<T = Record<string, unknown>>(
  connection: ConnectionOptions,
  sql: string,
  params: unknown[] = [],
  timeoutMs = 10_000,
): Promise<T[]> {
  const ca = connection.sslrootcert
    ? await readFile(connection.sslrootcert, "utf8").catch(() => undefined)
    : undefined;
  const client = await newClient(buildClientConfig(connection, ca));
  try {
    await client.connect();
  } catch (err) {
    throw mapConnectError(err);
  }
  try {
    await client.query(`SET statement_timeout = ${msInt(timeoutMs)}`);
    const res = await client.query({ text: sql, values: params });
    return res.rows as T[];
  } catch (err) {
    throw mapQueryError(err);
  } finally {
    await client.end().catch(() => {});
  }
}

export interface ScriptUnitInput {
  label: string;
  sql: string;
  loopNote?: string;
}

export interface ScriptUnitResult {
  label: string;
  loopNote?: string;
  /** Cost-only EXPLAIN (FORMAT JSON) output, or undefined if this unit failed. */
  planJson?: string;
  /** Set when this unit's EXPLAIN failed (e.g. references a column that doesn't exist). */
  error?: Diagnostic;
}

export interface ScriptResult {
  units: ScriptUnitResult[];
  caps: ServerCapabilities;
}

/**
 * Cost-only EXPLAIN of many statements in one read-only, rolled-back transaction.
 * NEVER executes: no ANALYZE, no BUFFERS — so no rows are touched, no sequence
 * advances, no triggers/FDW/file side effects. GENERIC_PLAN is used for statements
 * with $n parameters on PG16+. A failing unit is captured (not thrown) so one bad
 * branch can't sink the rest.
 */
export async function explainScript(
  connection: ConnectionOptions,
  units: ScriptUnitInput[],
  opts: {
    statementTimeoutMs: number;
    lockTimeoutMs: number;
    verbose?: boolean;
    settings?: boolean;
  },
): Promise<ScriptResult> {
  const ca = connection.sslrootcert
    ? await readFile(connection.sslrootcert, "utf8").catch(() => undefined)
    : undefined;
  const client = await newClient(buildClientConfig(connection, ca));
  try {
    await client.connect();
  } catch (err) {
    throw mapConnectError(err);
  }

  try {
    const caps = capabilities(await fetchVersionNum(client));
    await client.query("BEGIN");
    const results: ScriptUnitResult[] = [];
    try {
      await client.query(`SET LOCAL statement_timeout = ${msInt(opts.statementTimeoutMs)}`);
      await client.query(`SET LOCAL lock_timeout = ${msInt(opts.lockTimeoutMs)}`);
      await client.query("SET LOCAL transaction_read_only = on");

      for (const unit of units) {
        const flags: ExplainFlags = {
          analyze: false, // never execute
          buffers: false, // BUFFERS requires ANALYZE pre-16
          verbose: opts.verbose ?? false,
          settings: opts.settings ?? false,
          wal: false,
          timing: false,
          costs: true,
          summary: false,
          genericPlan: caps.genericPlan && /\$\d+/.test(unit.sql),
          compat: true, // auto-omit anything the server is too old for
        };
        try {
          const { prefix } = buildExplain(flags, caps);
          const res = await client.query<{ "QUERY PLAN": unknown }>(`${prefix} ${unit.sql}`);
          const r: ScriptUnitResult = { label: unit.label, planJson: extractPlanJson(res.rows) };
          if (unit.loopNote) r.loopNote = unit.loopNote;
          results.push(r);
          // EXPLAIN-without-ANALYZE can leave the txn aborted only on error; reset just in case.
        } catch (err) {
          const diag = err instanceof AppError ? err.diagnostic : mapQueryError(err).diagnostic;
          const r: ScriptUnitResult = { label: unit.label, error: diag };
          if (unit.loopNote) r.loopNote = unit.loopNote;
          results.push(r);
          // A failed statement aborts the transaction; roll back to a clean savepoint-less state.
          await client.query("ROLLBACK").catch(() => {});
          await client.query("BEGIN").catch(() => {});
          await client.query("SET LOCAL transaction_read_only = on").catch(() => {});
        }
      }
      return { units: results, caps };
    } finally {
      await client.query("ROLLBACK").catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function fetchVersionNum(client: Client): Promise<number> {
  try {
    const res = await client.query<{ server_version_num: string }>("SHOW server_version_num");
    return Number(res.rows[0]?.server_version_num ?? 0);
  } catch (err) {
    throw mapQueryError(err);
  }
}

function extractPlanJson(rows: Array<{ "QUERY PLAN": unknown }>): string {
  const value = rows[0]?.["QUERY PLAN"];
  if (value === undefined) {
    throw opError("PGX_UNEXPECTED_PLAN_SHAPE", {
      detail: "The server returned no plan rows for EXPLAIN.",
    });
  }
  // pg parses the json column into a JS value; re-serialize for the parser.
  return typeof value === "string" ? value : JSON.stringify(value);
}

// ── error mapping (SQLSTATE / network → actionable PGX codes) ─────────────────

interface PgError {
  code?: string;
  message?: string;
  routine?: string;
}

function asPgError(err: unknown): PgError {
  if (err && typeof err === "object") return err as PgError;
  return { message: String(err) };
}

function mapConnectError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = asPgError(err);
  const msg = e.message ?? "";

  switch (e.code) {
    case "28P01":
    case "28000":
      return opError("PGX_AUTH_FAILED", { detail: msg }, err);
    case "3D000":
      return opError("PGX_DB_NOT_FOUND", { detail: msg }, err);
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "EHOSTUNREACH":
      return opError("PGX_HOST_UNREACHABLE", { detail: msg }, err);
    case "ETIMEDOUT":
      return opError("PGX_CONN_TIMEOUT", { detail: msg }, err);
  }
  if (/timeout/i.test(msg)) return opError("PGX_CONN_TIMEOUT", { detail: msg }, err);
  if (/self.signed|certificate|verify|CERT_/i.test(msg))
    return opError("PGX_SSL_VERIFY_FAILED", { detail: msg }, err);
  if (/SSL|encryption/i.test(msg)) return opError("PGX_SSL_REQUIRED", { detail: msg }, err);
  return opError("PGX_HOST_UNREACHABLE", { detail: msg }, err);
}

function mapQueryError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = asPgError(err);
  const msg = e.message ?? "";
  const meta = e.code ? { sqlState: e.code } : undefined;

  switch (e.code) {
    case "57014":
      return /statement timeout/i.test(msg)
        ? opError("PGX_STATEMENT_TIMEOUT", { detail: msg, meta }, err)
        : opError("PGX_QUERY_CANCELED", { detail: msg, meta }, err);
    case "55P03":
      return opError("PGX_LOCK_TIMEOUT", { detail: msg, meta }, err);
    case "42501":
      return opError("PGX_PERMISSION_DENIED", { detail: msg, meta }, err);
    case "42P01":
      return opError("PGX_RELATION_NOT_FOUND", { detail: msg, meta }, err);
    case "28P01":
    case "28000":
      return opError("PGX_AUTH_FAILED", { detail: msg, meta }, err);
    case "3D000":
      return opError("PGX_DB_NOT_FOUND", { detail: msg, meta }, err);
    default:
      return opError("PGX_QUERY_FAILED", { detail: msg, meta }, err);
  }
}
