import { opError } from "../diagnostics/catalog.ts";
import type { ServerCapabilities } from "./version.ts";
import { versionLabel } from "./version.ts";

export interface ExplainFlags {
  analyze: boolean;
  buffers: boolean;
  verbose: boolean;
  settings: boolean;
  wal: boolean;
  /** Default true; set false to add TIMING OFF (reduces ANALYZE overhead). */
  timing: boolean;
  /** Default true; set false to add COSTS OFF. */
  costs: boolean;
  summary: boolean;
  genericPlan: boolean;
  /** Auto-omit options the server can't do instead of erroring. */
  compat: boolean;
}

export const DEFAULT_EXPLAIN_FLAGS: ExplainFlags = {
  analyze: true,
  buffers: true,
  verbose: false,
  settings: false,
  wal: false,
  timing: true,
  costs: true,
  summary: true,
  genericPlan: false,
  compat: false,
};

export interface BuiltExplain {
  /** The EXPLAIN prefix, e.g. "EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)". */
  prefix: string;
  /** Options dropped under --compat because the server is too old. */
  omitted: string[];
}

/** Build the EXPLAIN option list, gating each option on the server version. */
export function buildExplain(flags: ExplainFlags, caps: ServerCapabilities): BuiltExplain {
  if (flags.genericPlan && flags.analyze) {
    throw opError("PGX_INVALID_EXPLAIN_OPTION", {
      detail:
        "GENERIC_PLAN cannot be combined with ANALYZE (GENERIC_PLAN does not execute the query).",
    });
  }
  if (flags.wal && !flags.analyze) {
    throw opError("PGX_INVALID_EXPLAIN_OPTION", { detail: "WAL requires ANALYZE." });
  }

  const opts: string[] = ["FORMAT JSON"];
  const omitted: string[] = [];

  const gate = (label: string, supported: boolean, requiredMajor: number): boolean => {
    if (supported) return true;
    if (flags.compat) {
      omitted.push(label);
      return false;
    }
    throw opError("PGX_UNSUPPORTED_PG_VERSION", {
      detail: `EXPLAIN (${label}) requires PostgreSQL ${requiredMajor}; server is ${versionLabel(caps.versionNum)}.`,
      meta: { option: label, requiredMajor, serverVersion: caps.versionNum },
    });
  };

  if (flags.genericPlan && gate("GENERIC_PLAN", caps.genericPlan, 16)) opts.push("GENERIC_PLAN");
  if (flags.analyze) opts.push("ANALYZE");
  if (flags.buffers) opts.push("BUFFERS");
  if (flags.verbose) opts.push("VERBOSE");
  if (flags.settings && gate("SETTINGS", caps.settings, 12)) opts.push("SETTINGS");
  if (flags.wal && gate("WAL", caps.wal, 13)) opts.push("WAL");
  if (!flags.costs) opts.push("COSTS OFF");
  if (flags.analyze && !flags.timing) opts.push("TIMING OFF");
  if (!flags.summary && caps.summary) opts.push("SUMMARY OFF");

  return { prefix: `EXPLAIN (${opts.join(", ")})`, omitted };
}

// ── statement handling ────────────────────────────────────────────────────────

/** Strip leading comments/whitespace to find the first real keyword. */
function leadingKeyword(sql: string): string {
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  return (cleaned.split(/\s+/)[0] ?? "").toUpperCase();
}

/** True for statements EXPLAIN ANALYZE can run without changing data. */
export function isReadOnlyStatement(sql: string): boolean {
  const kw = leadingKeyword(sql);
  if (["SELECT", "TABLE", "VALUES", "SHOW", "EXPLAIN"].includes(kw)) return true;
  // A WITH may wrap a data-modifying CTE — treat as mutating if so.
  if (kw === "WITH") return !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql);
  return false;
}

/**
 * Split a SQL string into top-level statements, respecting string literals,
 * quoted identifiers, line/block comments, and dollar-quoted bodies.
 * ponytail: handles real-world SQL; exotic nested cases fall back to one statement.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      buf += sql.slice(i, end);
      i = end;
    } else if (two === "/*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      buf += sql.slice(i, end);
      i = end;
    } else if (ch === "'" || ch === '"') {
      const end = scanQuoted(sql, i, ch);
      buf += sql.slice(i, end);
      i = end;
    } else if (ch === "$") {
      const tag = matchDollarTag(sql, i);
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, end);
        i = end;
      } else {
        buf += ch;
        i++;
      }
    } else if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function scanQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote)
        i += 2; // doubled escape
      else return i + 1;
    } else {
      i++;
    }
  }
  return sql.length;
}

function matchDollarTag(sql: string, start: number): string | null {
  const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(start));
  return m ? m[0] : null;
}

/** Parse a duration like "60s", "500ms", "2min", or a bare integer (ms) into ms. */
export function parseDurationMs(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|min|m|h)?$/.exec(value.trim());
  if (!m?.[1])
    throw opError("PGX_INVALID_EXPLAIN_OPTION", {
      detail: `Invalid duration '${value}'. Use e.g. 60s, 500ms, 2min.`,
    });
  const n = Number(m[1]);
  switch (m[2]) {
    case "s":
      return Math.round(n * 1000);
    case "min":
    case "m":
      return Math.round(n * 60_000);
    case "h":
      return Math.round(n * 3_600_000);
    default:
      return Math.round(n); // ms or bare integer
  }
}
