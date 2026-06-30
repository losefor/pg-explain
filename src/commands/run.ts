import { readFile } from "node:fs/promises";
import type { PgExplainConfig } from "../config.ts";
import { type ConnectionOptions, runExplain } from "../db/client.ts";
import { type ExplainFlags, isReadOnlyStatement, splitStatements } from "../db/explain.ts";
import { opError } from "../diagnostics/catalog.ts";
import { analyze } from "../index.ts";
import { extractAnalyzableUnits } from "../sql/extract.ts";
import type { ExitCode } from "../util/exit.ts";
import { logInfo } from "../util/log.ts";
import { type EmitOptions, emit } from "./emit.ts";
import { analyzeScript, emitScript } from "./script.ts";

export interface RunArgs extends EmitOptions {
  connection: ConnectionOptions;
  query?: string;
  file?: string;
  statementIndex?: number;
  /** Values for $1, $2, … in the statement. */
  params?: string[];
  flags: ExplainFlags;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  forceWrite: boolean;
  rollback: boolean;
  redact?: boolean;
  config: PgExplainConfig;
}

/** run command: connect, EXPLAIN (safely), parse, analyze, render. */
export async function runRun(args: RunArgs): Promise<ExitCode> {
  const fullSql = await resolveSql(args);
  // --statement narrows to one top-level statement first (which may itself be a DO block).
  const sql =
    args.statementIndex !== undefined
      ? selectStatement(splitStatements(fullSql), args.statementIndex)
      : fullSql;

  const units = extractAnalyzableUnits(sql);
  const single = units.length === 1 && units[0]?.kind === "explainable" ? units[0] : null;

  // Measured path (executes): a single statement that is read-only (SELECT) or explicitly
  // forced, with ANALYZE on. Everything else — DO blocks, multiple statements, writes
  // without --force, --no-analyze, --generic-plan — takes the cost-only path that NEVER runs.
  const measured =
    single?.kind === "explainable" &&
    args.flags.analyze &&
    !args.flags.genericPlan &&
    (isReadOnlyStatement(single.sql) || args.forceWrite);

  if (measured && single) {
    const result = await runExplain({
      connection: args.connection,
      statement: single.sql,
      params: args.params,
      flags: args.flags,
      statementTimeoutMs: args.statementTimeoutMs,
      lockTimeoutMs: args.lockTimeoutMs,
      forceWrite: args.forceWrite,
      rollback: args.rollback,
    });
    if (result.omitted.length) {
      logInfo(
        `Note: server is PostgreSQL ${result.caps.major}; skipped unsupported option(s): ${result.omitted.join(", ")}.`,
      );
    }
    const analysis = analyze(result.json, {
      config: args.config,
      redact: args.redact,
      sql: single.sql,
    });
    return emit(analysis, args);
  }

  // Cost-only safe path: extract analyzable statements and EXPLAIN each without executing.
  const analysis = await analyzeScript(args.connection, sql, {
    config: args.config,
    redact: args.redact,
    statementTimeoutMs: args.statementTimeoutMs,
    lockTimeoutMs: args.lockTimeoutMs,
    verbose: args.flags.verbose,
    settings: args.flags.settings,
  });
  return emitScript(analysis, {
    format: args.format,
    output: args.output,
    color: args.color,
    ascii: args.ascii,
    tldr: args.tldr,
    pretty: args.pretty,
    failOn: args.failOn,
  });
}

async function resolveSql(args: RunArgs): Promise<string> {
  if (args.query) return args.query;
  if (args.file) {
    try {
      return await readFile(args.file, "utf8");
    } catch (err) {
      throw opError(
        "PGX_EMPTY_INPUT",
        {
          detail: `Could not read SQL file '${args.file}': ${err instanceof Error ? err.message : String(err)}`,
        },
        err,
      );
    }
  }
  throw opError("PGX_EMPTY_INPUT", {
    detail: "The run command needs SQL: pass --query '<sql>' or --file <path.sql>.",
  });
}

function selectStatement(statements: string[], index?: number): string {
  if (statements.length === 0) {
    throw opError("PGX_EMPTY_INPUT", { detail: "No SQL statement found after parsing." });
  }
  if (index !== undefined) {
    const stmt = statements[index - 1];
    if (!stmt) {
      throw opError("PGX_MULTIPLE_STATEMENTS", {
        detail: `--statement ${index} is out of range; found ${statements.length} statement(s).`,
      });
    }
    return stmt;
  }
  if (statements.length > 1) {
    throw opError("PGX_MULTIPLE_STATEMENTS", {
      detail: `Found ${statements.length} statements. Pick one with --statement <n> (1-based).`,
    });
  }
  // Length is exactly 1 here.
  return statements[0] as string;
}
