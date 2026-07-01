import { defineCommand, runMain } from "citty";
import pkg from "../package.json" with { type: "json" };
import { runAnalyze } from "./commands/analyze.ts";
import { runCompletion } from "./commands/completion.ts";
import { runDiff } from "./commands/diff.ts";
import type { EmitOptions } from "./commands/emit.ts";
import { runLocks } from "./commands/locks.ts";
import { runRun } from "./commands/run.ts";
import { runStudio } from "./commands/studio.ts";
import { loadConfig } from "./config.ts";
import type { Diagnostic, Severity } from "./core/model.ts";
import type { ConnectionOptions } from "./db/client.ts";
import { type ExplainFlags, parseDurationMs } from "./db/explain.ts";
import { opDiagnostic } from "./diagnostics/catalog.ts";
import { AppError, scrubCredentials } from "./diagnostics/diagnostic.ts";
import { formatDiagnostic } from "./diagnostics/print.ts";
import { type Format, isFormat } from "./report/render.ts";
import { configureColor } from "./util/color.ts";
import { ExitCode } from "./util/exit.ts";
import { isDebug, logError, setLogLevel } from "./util/log.ts";

const SEVERITIES: Severity[] = ["error", "warn", "info"];

// biome-ignore lint/suspicious/noExplicitAny: citty's parsed args are loosely typed.
type Args = Record<string, any>;

const outputArgs = {
  format: {
    type: "string",
    default: "terminal",
    alias: "f",
    description: "terminal | markdown | json | html | text",
  },
  output: {
    type: "string",
    alias: "o",
    description: "Write the report to a file instead of stdout",
  },
  tldr: { type: "boolean", description: "Summary + findings only (no plan tree)" },
  redact: { type: "boolean", description: "Strip literal values from expressions (safe to share)" },
  open: {
    type: "boolean",
    description: "Open the HTML report in your browser (default: on when interactive)",
  },
  "no-open": { type: "boolean", description: "Never open the HTML report in the browser" },
  ascii: { type: "boolean", description: "Use ASCII tree glyphs instead of Unicode" },
  color: { type: "string", default: "auto", description: "auto | always | never" },
  "no-color": { type: "boolean", description: "Disable color (same as --color never)" },
  "fail-on": {
    type: "string",
    description: "CI gate: exit 1 if a finding at/above info|warn|error exists",
  },
  strict: { type: "boolean", description: "Shorthand for --fail-on warn" },
  config: {
    type: "string",
    description: "Path to a config file (default: .pgexplainrc[.json] / package.json#pgExplain)",
  },
  compact: { type: "boolean", description: "Compact JSON output" },
  quiet: { type: "boolean", alias: "q", description: "Suppress non-error logs" },
  verbose: { type: "boolean", description: "Extra diagnostic logging" },
  debug: { type: "boolean", description: "Print stack traces on internal errors" },
} as const;

function applyGlobalFlags(args: Args): void {
  setLogLevel(args.quiet ? "quiet" : args.debug ? "debug" : args.verbose ? "verbose" : "normal");
  const mode = args["no-color"] ? "never" : (args.color as string);
  configureColor(mode === "always" || mode === "never" ? mode : "auto");
}

function emitOptionsFrom(args: Args): EmitOptions {
  const opts: EmitOptions = {
    format: resolveFormat(args.format),
    color: (args["no-color"] ? "never" : args.color) as "auto" | "always" | "never",
    ascii: args.ascii,
    tldr: args.tldr,
    pretty: !args.compact,
  };
  if (args.output) opts.output = args.output;
  const failOn = resolveFailOn(args);
  if (failOn) opts.failOn = failOn;
  // Auto-open HTML when interactive; --open forces it, --no-open / CI disables it.
  opts.openHtml = args["no-open"]
    ? false
    : args.open
      ? true
      : Boolean(process.stdout.isTTY) && !process.env.CI;
  return opts;
}

function resolveFormat(value: string): Format {
  if (isFormat(value)) return value;
  throw usageError(
    `Unknown --format '${value}'`,
    "Pick one of: terminal, markdown, json, html, text.",
  );
}

function resolveFailOn(args: Args): Severity | undefined {
  if (args.strict) return "warn";
  const value = args["fail-on"] as string | undefined;
  if (value === undefined) return undefined;
  if ((SEVERITIES as string[]).includes(value)) return value as Severity;
  throw usageError(`Unknown --fail-on '${value}'`, "Use one of: info, warn, error.");
}

function resolveStatement(args: Args): number | undefined {
  const raw = (args.statement ?? args.stmt) as string | undefined;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw usageError(`Invalid --statement '${raw}'`, "Use a 1-based integer.");
  return n;
}

function usageError(title: string, fix: string): AppError {
  const diagnostic: Diagnostic = {
    code: "PGX_USAGE",
    domain: "operational",
    severity: "error",
    title,
    detail: "The command could not be run as given.",
    cause: "Invalid command-line usage.",
    remediation: {
      summary: fix,
      commands: [{ label: "See all options", shell: "pg-explain --help" }],
    },
  };
  return new AppError(diagnostic, ExitCode.Usage);
}

function handleFatal(err: unknown): ExitCode {
  if (err instanceof AppError) {
    logError(formatDiagnostic(err.diagnostic));
    return err.exitCode;
  }
  logError(formatDiagnostic(opDiagnostic("PGX_INTERNAL")));
  if (isDebug() && err instanceof Error && err.stack) logError(scrubCredentials(err.stack));
  return ExitCode.Internal;
}

// ── run subcommand ────────────────────────────────────────────────────────────

const runCmd = defineCommand({
  meta: {
    name: "run",
    description: "Connect to PostgreSQL, run EXPLAIN safely, and analyze the result.",
  },
  args: {
    dsn: {
      type: "string",
      description: "Connection string (or use --host/--port/… or PG* env vars)",
    },
    host: { type: "string", description: "Server host" },
    port: { type: "string", description: "Server port" },
    dbname: { type: "string", alias: "d", description: "Database name" },
    user: { type: "string", alias: "U", description: "Role name" },
    sslmode: { type: "string", description: "disable | require | verify-ca | verify-full" },
    sslrootcert: { type: "string", description: "Path to a CA certificate (PEM)" },
    "connect-timeout": {
      type: "string",
      default: "10s",
      description: "Connection timeout (e.g. 30s)",
    },
    query: { type: "string", description: "SQL to explain" },
    file: { type: "string", description: "Path to a .sql file to explain" },
    statement: { type: "string", description: "1-based statement index when the file has several" },
    param: { type: "string", description: "Value for $1, $2, … (repeatable)" },
    "statement-timeout": {
      type: "string",
      default: "30s",
      description: "statement_timeout for the run",
    },
    "lock-timeout": { type: "string", default: "5s", description: "lock_timeout for the run" },
    force: {
      type: "boolean",
      description: "Allow a non-SELECT to execute (still auto-rolled-back)",
    },
    "no-rollback": {
      type: "boolean",
      description: "Do not wrap the run in a rolled-back transaction (dangerous)",
    },
    "no-analyze": { type: "boolean", description: "Do not execute the query; plan estimates only" },
    "no-buffers": { type: "boolean", description: "Omit BUFFERS" },
    "explain-verbose": {
      type: "boolean",
      description: "Add EXPLAIN VERBOSE (output columns, schemas)",
    },
    settings: { type: "boolean", description: "Add EXPLAIN SETTINGS (PG12+)" },
    wal: { type: "boolean", description: "Add EXPLAIN WAL (PG13+, needs ANALYZE)" },
    "generic-plan": {
      type: "boolean",
      description: "EXPLAIN GENERIC_PLAN (PG16+, does not execute)",
    },
    "no-timing": { type: "boolean", description: "Add TIMING OFF (reduces ANALYZE overhead)" },
    "no-costs": { type: "boolean", description: "Add COSTS OFF" },
    compat: { type: "boolean", description: "Auto-omit EXPLAIN options the server is too old for" },
    ...outputArgs,
  },
  async run({ args }) {
    try {
      applyGlobalFlags(args);
      const connection: ConnectionOptions = {
        connectTimeoutMs: parseDurationMs(args["connect-timeout"]),
      };
      if (args.dsn) connection.dsn = args.dsn;
      if (args.host) connection.host = args.host;
      if (args.port) connection.port = Number(args.port);
      if (args.dbname) connection.database = args.dbname;
      if (args.user) connection.user = args.user;
      if (args.sslmode) connection.sslmode = args.sslmode;
      if (args.sslrootcert) connection.sslrootcert = args.sslrootcert;

      const flags: ExplainFlags = {
        analyze: !args["no-analyze"],
        buffers: !args["no-buffers"],
        verbose: !!args["explain-verbose"],
        settings: !!args.settings,
        wal: !!args.wal,
        timing: !args["no-timing"],
        costs: !args["no-costs"],
        summary: true,
        genericPlan: !!args["generic-plan"],
        compat: !!args.compat,
      };

      const params = Array.isArray(args.param) ? args.param : args.param ? [args.param] : undefined;

      process.exitCode = await runRun({
        ...emitOptionsFrom(args),
        config: await loadConfig(args.config),
        connection,
        query: args.query,
        file: args.file,
        statementIndex: resolveStatement(args),
        params,
        flags,
        statementTimeoutMs: parseDurationMs(args["statement-timeout"]),
        lockTimeoutMs: parseDurationMs(args["lock-timeout"]),
        forceWrite: !!args.force,
        rollback: !args["no-rollback"],
        redact: args.redact,
      });
    } catch (err) {
      process.exitCode = handleFatal(err);
    }
  },
});

// ── diff subcommand ───────────────────────────────────────────────────────────

const diffCmd = defineCommand({
  meta: {
    name: "diff",
    description: "Compare two EXPLAIN plans (before → after) and report regressions.",
  },
  args: {
    before: { type: "positional", required: true, description: "Baseline plan JSON file" },
    after: { type: "positional", required: true, description: "New plan JSON file" },
    format: {
      type: "string",
      default: "terminal",
      alias: "f",
      description: "terminal | markdown | json",
    },
    output: { type: "string", alias: "o", description: "Write to a file instead of stdout" },
    color: { type: "string", default: "auto", description: "auto | always | never" },
    "no-color": { type: "boolean", description: "Disable color" },
    redact: { type: "boolean", description: "Strip literal values before comparing" },
    config: { type: "string", description: "Path to a config file" },
    "fail-on-slower": {
      type: "string",
      description: "Exit 1 if execution time regresses by ≥ this percent",
    },
    "fail-on-new-findings": { type: "boolean", description: "Exit 1 if any new finding appears" },
    quiet: { type: "boolean", alias: "q", description: "Suppress non-error logs" },
    debug: { type: "boolean", description: "Print stack traces on internal errors" },
  },
  async run({ args }) {
    try {
      applyGlobalFlags(args);
      const format = args.format as string;
      if (!["terminal", "markdown", "json"].includes(format)) {
        throw usageError(`Unknown diff --format '${format}'`, "Use terminal, markdown, or json.");
      }
      const diffArgs: import("./commands/diff.ts").DiffArgs = {
        before: args.before,
        after: args.after,
        format: format as "terminal" | "markdown" | "json",
        color: (args["no-color"] ? "never" : args.color) as "auto" | "always" | "never",
        redact: args.redact,
        config: await loadConfig(args.config),
        failOnNewFindings: !!args["fail-on-new-findings"],
      };
      if (args.output) diffArgs.output = args.output;
      if (args["fail-on-slower"] !== undefined) {
        const pct = Number(args["fail-on-slower"]);
        if (!Number.isFinite(pct))
          throw usageError(
            `Invalid --fail-on-slower '${args["fail-on-slower"]}'`,
            "Use a number, e.g. 20.",
          );
        diffArgs.failOnSlowerPct = pct;
      }
      process.exitCode = await runDiff(diffArgs);
    } catch (err) {
      process.exitCode = handleFatal(err);
    }
  },
});

// ── locks subcommand ──────────────────────────────────────────────────────────

const locksCmd = defineCommand({
  meta: {
    name: "locks",
    description: "Snapshot live lock contention: who is blocked, and by whom.",
  },
  args: {
    dsn: {
      type: "string",
      description: "Connection string (or use --host/--port/… or PG* env vars)",
    },
    host: { type: "string", description: "Server host" },
    port: { type: "string", description: "Server port" },
    dbname: { type: "string", alias: "d", description: "Database name" },
    user: { type: "string", alias: "U", description: "Role name" },
    sslmode: { type: "string", description: "disable | require | verify-ca | verify-full" },
    sslrootcert: { type: "string", description: "Path to a CA certificate (PEM)" },
    "connect-timeout": {
      type: "string",
      default: "10s",
      description: "Connection timeout (e.g. 30s)",
    },
    format: { type: "string", default: "terminal", alias: "f", description: "terminal | json" },
    output: { type: "string", alias: "o", description: "Write to a file instead of stdout" },
    color: { type: "string", default: "auto", description: "auto | always | never" },
    "no-color": { type: "boolean", description: "Disable color" },
    "fail-on-blocked": {
      type: "boolean",
      description: "Exit 1 if any session is currently blocked",
    },
    quiet: { type: "boolean", alias: "q", description: "Suppress non-error logs" },
    debug: { type: "boolean", description: "Print stack traces on internal errors" },
  },
  async run({ args }) {
    try {
      applyGlobalFlags(args);
      if (!["terminal", "json"].includes(args.format as string)) {
        throw usageError(`Unknown locks --format '${args.format}'`, "Use terminal or json.");
      }
      const connection: ConnectionOptions = {
        connectTimeoutMs: parseDurationMs(args["connect-timeout"]),
      };
      if (args.dsn) connection.dsn = args.dsn;
      if (args.host) connection.host = args.host;
      if (args.port) connection.port = Number(args.port);
      if (args.dbname) connection.database = args.dbname;
      if (args.user) connection.user = args.user;
      if (args.sslmode) connection.sslmode = args.sslmode;
      if (args.sslrootcert) connection.sslrootcert = args.sslrootcert;

      process.exitCode = await runLocks({
        connection,
        format: args.format as "terminal" | "json",
        output: args.output,
        color: (args["no-color"] ? "never" : args.color) as "auto" | "always" | "never",
        failOnBlocked: !!args["fail-on-blocked"],
      });
    } catch (err) {
      process.exitCode = handleFatal(err);
    }
  },
});

// ── studio subcommand ─────────────────────────────────────────────────────────

const studioCmd = defineCommand({
  meta: { name: "studio", description: "Launch the local pgexplain Studio web app." },
  args: {
    port: { type: "string", default: "5177", description: "Port to listen on" },
    host: {
      type: "string",
      default: "127.0.0.1",
      description: "Host to bind (loopback only unless --unsafe-host)",
    },
    "no-open": { type: "boolean", description: "Do not open the browser automatically" },
    "unsafe-host": {
      type: "boolean",
      description: "Allow binding a non-loopback host (SSRF/credential risk)",
    },
    debug: { type: "boolean", description: "Print stack traces on internal errors" },
  },
  async run({ args }) {
    try {
      applyGlobalFlags(args);
      const port = Number(args.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw usageError(`Invalid --port '${args.port}'`, "Use a port between 0 and 65535.");
      }
      process.exitCode = await runStudio({
        host: args.host,
        port,
        open: !args["no-open"],
        unsafeHost: !!args["unsafe-host"],
      });
    } catch (err) {
      process.exitCode = handleFatal(err);
    }
  },
});

// ── main (analyze) command ────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: "pg-explain",
    version: pkg.version,
    description:
      "Analyze a PostgreSQL EXPLAIN plan and report fixable findings. Pipe a plan or pass a file; use `pg-explain run --help` to execute a query and explain it.",
  },
  args: {
    file: {
      type: "positional",
      required: false,
      description: "Plan JSON file (default: read stdin)",
    },
    statement: {
      type: "string",
      description: "1-based statement index when the input holds several",
    },
    ...outputArgs,
  },
  async run({ args }) {
    try {
      applyGlobalFlags(args);
      process.exitCode = await runAnalyze({
        ...emitOptionsFrom(args),
        config: await loadConfig(args.config),
        file: args.file,
        statement: resolveStatement(args),
        redact: args.redact,
      });
    } catch (err) {
      process.exitCode = handleFatal(err);
    }
  },
});

process.on("SIGINT", () => process.exit(ExitCode.Sigint));
process.on("SIGTERM", () => process.exit(ExitCode.Sigint));

// Manual dispatch: citty's subCommands treat any first positional as a subcommand
// name (throwing on unknown), which conflicts with our positional plan-file argument.
// Routing by argv[0] keeps `pg-explain plan.json` and `pg-explain run …` both working.
const argv = process.argv.slice(2);

if (argv[0] === "completion") {
  process.exitCode = runCompletion(argv[1]);
} else {
  const started =
    argv[0] === "run"
      ? runMain(runCmd, { rawArgs: argv.slice(1) })
      : argv[0] === "diff"
        ? runMain(diffCmd, { rawArgs: argv.slice(1) })
        : argv[0] === "locks"
          ? runMain(locksCmd, { rawArgs: argv.slice(1) })
          : argv[0] === "studio"
            ? runMain(studioCmd, { rawArgs: argv.slice(1) })
            : runMain(main, { rawArgs: argv });

  started.catch((err) => {
    process.exitCode = handleFatal(err);
  });
}
