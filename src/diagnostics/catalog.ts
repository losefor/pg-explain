import type { Diagnostic, DiagnosticLocation, Severity } from "../core/model.ts";
import { ExitCode } from "../util/exit.ts";
import { AppError } from "./diagnostic.ts";

const DOCS = "https://www.postgresql.org/docs/current";

interface OpSpec {
  severity: Severity;
  exit: ExitCode;
  title: string;
  detail: string;
  cause: string;
  remediation: Diagnostic["remediation"];
  docsUrl?: string;
}

/**
 * The operational error catalog. Every entry tells the developer WHAT happened,
 * WHY, and HOW to fix it. Codes are stable and greppable; they never change meaning.
 * Dynamic specifics (host, user, db, timeout) are injected via `overrides.detail`.
 */
const CATALOG = {
  PGX_AUTH_FAILED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Authentication failed",
    detail: "The server rejected the supplied credentials.",
    cause:
      "The password or role is wrong, or pg_hba.conf does not permit this role from your host.",
    remediation: {
      summary: "Verify the credentials and supply the password safely (never on the command line).",
      steps: [
        "Confirm the username and password are correct.",
        "Provide the password via PGPASSWORD or ~/.pgpass instead of the command line.",
        "Check that pg_hba.conf allows this role from your client host.",
      ],
      commands: [
        { label: "Set password via env", shell: "export PGPASSWORD=<password>" },
        {
          label: "Or store it (chmod 600)",
          shell: 'echo "<host>:<port>:<db>:<user>:<password>" >> ~/.pgpass && chmod 600 ~/.pgpass',
        },
      ],
    },
    docsUrl: `${DOCS}/auth-pg-hba-conf.html`,
  },

  PGX_HOST_UNREACHABLE: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Cannot reach the PostgreSQL server",
    detail: "DNS resolution failed or the TCP connection was refused.",
    cause:
      "Wrong host/port, the server is down, or a firewall/VPN/security group is blocking the port.",
    remediation: {
      summary: "Verify the host and port, then probe reachability.",
      steps: [
        "Double-check --host and --port (or the DSN) for typos.",
        "Confirm the server is running and accepts TCP connections.",
        "Check VPN, firewall, and cloud security-group rules for the port.",
      ],
      commands: [{ label: "Probe reachability", shell: "pg_isready -h <host> -p <port>" }],
    },
    docsUrl: `${DOCS}/libpq-connect.html`,
  },

  PGX_DB_NOT_FOUND: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Database does not exist",
    detail: "The named database was not found on the server.",
    cause: "The database name is misspelled or the database has not been created.",
    remediation: {
      summary: "List the available databases and correct the name.",
      commands: [
        { label: "List databases", shell: "psql -h <host> -U <user> -l" },
        { label: "Re-run with the right name", shell: "pg-explain run --dbname <name> ..." },
      ],
    },
  },

  PGX_SSL_REQUIRED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Server requires SSL",
    detail: "The server requires an encrypted connection but a plaintext one was offered.",
    cause: "pg_hba.conf mandates SSL (e.g. `hostssl`) for this role/host.",
    remediation: {
      summary: "Enable SSL on the connection.",
      commands: [
        { label: "Require encryption", shell: "pg-explain run --sslmode require ..." },
        {
          label: "Or verify the certificate too",
          shell: "pg-explain run --sslmode verify-full --sslrootcert <ca.pem> ...",
        },
      ],
    },
    docsUrl: `${DOCS}/libpq-ssl.html`,
  },

  PGX_SSL_VERIFY_FAILED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "TLS certificate verification failed",
    detail: "Under verify-full the certificate chain is untrusted or the hostname does not match.",
    cause:
      "The CA is not trusted locally, or the certificate's CN/SAN does not match the host you connect to.",
    remediation: {
      summary: "Point at the CA bundle and confirm the hostname matches the certificate.",
      steps: [
        "Provide the CA certificate the server's cert chains to.",
        "Confirm the certificate CN/SAN matches the --host value.",
        "Only fall back to `--sslmode require` (encryption without identity check) if you accept the risk.",
      ],
      commands: [
        {
          label: "Trust a CA",
          shell: "pg-explain run --sslmode verify-full --sslrootcert <ca.pem> ...",
        },
      ],
    },
    docsUrl: `${DOCS}/libpq-ssl.html`,
  },

  PGX_CONN_TIMEOUT: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Connection timed out",
    detail: "The connect handshake did not complete within the connect deadline.",
    cause: "High network latency, an overloaded server, or a firewall silently dropping packets.",
    remediation: {
      summary: "Raise the connect budget and investigate the network path.",
      commands: [
        { label: "Increase connect timeout", shell: "pg-explain run --connect-timeout 30s ..." },
      ],
    },
    docsUrl: `${DOCS}/libpq-connect.html`,
  },

  PGX_PERMISSION_DENIED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Permission denied",
    detail: "The connecting role lacks a privilege the query needs.",
    cause:
      "EXPLAIN must plan the query, which requires SELECT (and any referenced privileges) on the relations.",
    remediation: {
      summary: "Grant the missing privilege, or connect with a role that already has it.",
      commands: [
        { label: "Grant SELECT (run as owner)", sql: "GRANT SELECT ON <table> TO <role>;" },
      ],
    },
    docsUrl: `${DOCS}/sql-grant.html`,
  },

  PGX_RELATION_NOT_FOUND: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Relation does not exist",
    detail: "A table or view referenced by the query was not found.",
    cause: "The name is misspelled, or it lives in a schema that is not on the search_path.",
    remediation: {
      summary: "Schema-qualify the relation or set the search_path.",
      steps: ["Check spelling and the schema.", "List tables with `\\dt` in psql."],
      commands: [{ label: "Set the search path", sql: "SET search_path = <schema>, public;" }],
    },
  },

  PGX_STATEMENT_TIMEOUT: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Statement timeout reached",
    detail: "statement_timeout fired while EXPLAIN ANALYZE was executing the query.",
    cause: "The query genuinely takes longer than the configured statement_timeout to run.",
    remediation: {
      summary: "Raise the timeout, or avoid executing the query at all.",
      steps: [
        "Raise the per-run statement timeout.",
        "Or get an estimate-only plan that never executes (drop --analyze).",
        "Or reduce measurement overhead with --timing off.",
      ],
      commands: [
        { label: "Raise the timeout", shell: "pg-explain run --statement-timeout 60s ..." },
      ],
    },
    docsUrl: `${DOCS}/runtime-config-client.html#GUC-STATEMENT-TIMEOUT`,
  },

  PGX_LOCK_TIMEOUT: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Lock timeout reached",
    detail: "lock_timeout elapsed while waiting to acquire a lock on a relation.",
    cause: "Another transaction holds a conflicting lock on a relation the query touches.",
    remediation: {
      summary: "Raise the lock timeout, identify the blocker, or retry off-peak.",
      commands: [
        { label: "Raise the lock timeout", shell: "pg-explain run --lock-timeout 30s ..." },
        {
          label: "Find blockers",
          sql: "SELECT * FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE NOT l.granted;",
        },
      ],
    },
    docsUrl: `${DOCS}/runtime-config-client.html#GUC-LOCK-TIMEOUT`,
  },

  PGX_QUERY_CANCELED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "Query was canceled",
    detail: "The query was canceled by an administrator or a signal before completing.",
    cause:
      "An admin pg_cancel_backend call, a resource group, or a pool limit canceled the statement.",
    remediation: {
      summary: "Re-run the command; if it recurs, check for admin cancellation or pool limits.",
    },
  },

  PGX_UNSUPPORTED_PG_VERSION: {
    severity: "error",
    exit: ExitCode.Usage,
    title: "EXPLAIN option not supported by this server",
    detail: "A requested EXPLAIN option requires a newer PostgreSQL major version.",
    cause:
      "Options are version-gated (e.g. SETTINGS≥12, WAL≥13, GENERIC_PLAN≥16, SERIALIZE/MEMORY≥17).",
    remediation: {
      summary:
        "Drop the unsupported option, target a newer server, or let pg-explain auto-omit it.",
      commands: [{ label: "Auto-omit unsupported options", shell: "pg-explain run --compat ..." }],
    },
    docsUrl: `${DOCS}/sql-explain.html`,
  },

  PGX_INVALID_EXPLAIN_OPTION: {
    severity: "error",
    exit: ExitCode.Usage,
    title: "Invalid EXPLAIN option combination",
    detail: "The server rejected an EXPLAIN option or a mutually-exclusive combination.",
    cause:
      "Some options require ANALYZE (WAL, SERIALIZE, TIMING) and GENERIC_PLAN is incompatible with ANALYZE.",
    remediation: {
      summary: "Fix the option combination; see `pg-explain --help` for valid combinations.",
      steps: [
        "WAL/SERIALIZE/TIMING require --analyze.",
        "GENERIC_PLAN cannot be combined with --analyze.",
      ],
    },
    docsUrl: `${DOCS}/sql-explain.html`,
  },

  PGX_MALFORMED_JSON: {
    severity: "error",
    exit: ExitCode.Parse,
    title: "Input is not valid JSON",
    detail: "The plan input could not be parsed as JSON.",
    cause: "The input was truncated when captured, or it is not EXPLAIN (FORMAT JSON) output.",
    remediation: {
      summary: "Validate the input and make sure it is FORMAT JSON output.",
      commands: [{ label: "Validate JSON", shell: "jq . plan.json" }],
    },
  },

  PGX_UNEXPECTED_PLAN_SHAPE: {
    severity: "error",
    exit: ExitCode.Parse,
    title: "Input is not an EXPLAIN plan",
    detail: "The JSON parsed but does not contain a recognizable EXPLAIN plan tree.",
    cause: "The 'Plan' node is missing — this may be query result rows rather than a plan.",
    remediation: {
      summary: "Regenerate the plan with FORMAT JSON and pipe that in.",
      commands: [
        { label: "Capture a plan", sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <your query>;" },
      ],
    },
    docsUrl: `${DOCS}/sql-explain.html`,
  },

  PGX_EMPTY_INPUT: {
    severity: "error",
    exit: ExitCode.Input,
    title: "No plan input received",
    detail: "stdin and the named file were both empty.",
    cause: "No plan was piped in and no query/file was provided.",
    remediation: {
      summary: "Pipe a plan, or provide SQL to run.",
      commands: [
        { label: "Analyze a saved plan", shell: "pg-explain < plan.json" },
        { label: "Or run a query", shell: 'pg-explain run --query "<sql>" --dsn <dsn>' },
      ],
    },
  },

  PGX_NON_SELECT_REFUSED: {
    severity: "error",
    exit: ExitCode.Usage,
    title: "Refusing to ANALYZE a data-modifying statement",
    detail: "EXPLAIN ANALYZE executes the statement, and this one would modify data.",
    cause:
      "INSERT/UPDATE/DELETE/MERGE/DDL run for real under ANALYZE; running it could change your data.",
    remediation: {
      summary:
        "Use --force to run it inside an automatically rolled-back transaction, or drop --analyze.",
      steps: [
        "With --force, pg-explain wraps it as `BEGIN; <stmt>; ROLLBACK;` so nothing is committed.",
        "Without --analyze you get an estimate-only plan that never executes.",
      ],
      commands: [
        {
          label: "Run safely (auto-rollback)",
          shell: "pg-explain run --force --file mutation.sql --dsn <dsn>",
        },
      ],
    },
  },

  PGX_MULTIPLE_STATEMENTS: {
    severity: "error",
    exit: ExitCode.Usage,
    title: "Multiple SQL statements found",
    detail: "The input contains more than one statement; pg-explain analyzes one at a time.",
    cause: "A .sql file or --query string contained several semicolon-separated statements.",
    remediation: {
      summary: "Select one statement, or split them into separate invocations.",
      commands: [
        {
          label: "Pick the Nth statement (1-based)",
          shell: "pg-explain run --statement 2 --file queries.sql --dsn <dsn>",
        },
      ],
    },
  },

  PGX_COST_ONLY_PLAN: {
    severity: "info",
    exit: ExitCode.Success,
    title: "Cost-only plan — estimate-vs-actual checks unavailable",
    detail: "This plan has cost estimates but no actual row/time data.",
    cause: "It was produced by plain EXPLAIN (without ANALYZE), so runtime behavior is unknown.",
    remediation: {
      summary: "Re-run with ANALYZE to unlock estimate-vs-actual, timing, and spill findings.",
      commands: [
        { label: "Capture actuals", sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <query>;" },
      ],
    },
    docsUrl: `${DOCS}/using-explain.html#USING-EXPLAIN-ANALYZE`,
  },

  PGX_NO_BUFFERS: {
    severity: "info",
    exit: ExitCode.Success,
    title: "No BUFFERS data — cache/I/O analysis skipped",
    detail: "Buffer counters are absent, so cache-hit ratio and I/O findings cannot be computed.",
    cause: "The plan was captured without BUFFERS.",
    remediation: {
      summary: "Add BUFFERS to surface shared/temp block usage and the cache-hit ratio.",
      commands: [
        { label: "Capture buffers", sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <query>;" },
      ],
    },
  },

  PGX_EMPTY_PLAN: {
    severity: "info",
    exit: ExitCode.Success,
    title: "Nothing to analyze",
    detail: "The plan has no scans or joins to evaluate (e.g. a bare Result node).",
    cause: "The query is trivial and has no tuning surface.",
    remediation: { summary: "Confirm this is the query you intended to profile." },
  },

  PGX_PG_DRIVER_MISSING: {
    severity: "error",
    exit: ExitCode.Usage,
    title: "The 'pg' driver is not installed",
    detail: "The run command needs the PostgreSQL driver, which is an optional dependency.",
    cause:
      "pgexplain ships 'pg' as optional so plan-only use stays dependency-free; it isn't installed here.",
    remediation: {
      summary:
        "Install the pg driver, then re-run. (Plan-only analysis from a file/stdin needs no driver.)",
      commands: [
        { label: "with pnpm", shell: "pnpm add pg" },
        { label: "with npm", shell: "npm install pg" },
      ],
    },
  },

  PGX_QUERY_FAILED: {
    severity: "error",
    exit: ExitCode.Database,
    title: "The query could not be planned or executed",
    detail: "PostgreSQL returned an error while running EXPLAIN.",
    cause:
      "The statement has a syntax error, references something invalid, or hit a server-side limit.",
    remediation: {
      summary:
        "Read the server message below, fix the statement, and re-run. Test it in psql first if unsure.",
      commands: [{ label: "Try it directly", shell: 'psql "<dsn>" -c "EXPLAIN <your statement>"' }],
    },
    docsUrl: `${DOCS}/sql-explain.html`,
  },

  PGX_INTERNAL: {
    severity: "error",
    exit: ExitCode.Internal,
    title: "pg-explain hit an unexpected error",
    detail: "This is a bug in pg-explain, not in your query or plan.",
    cause: "An unhandled condition was reached.",
    remediation: {
      summary: "Re-run with --debug for a credential-scrubbed stack trace, then file an issue.",
      commands: [
        { label: "Show the trace", shell: "pg-explain --debug ..." },
        { label: "Report your version", shell: "pg-explain --version" },
      ],
    },
  },
} satisfies Record<string, OpSpec>;

export type OpCode = keyof typeof CATALOG;

/** Every operational code, for iteration (docs generation, completeness tests). */
export const OP_CODES = Object.keys(CATALOG) as OpCode[];

interface OpOverrides {
  /** Replace the default detail with situation-specific text (will be credential-scrubbed by the caller). */
  detail?: string;
  meta?: Diagnostic["meta"];
  location?: DiagnosticLocation;
}

/** Build the Diagnostic for an operational code (used for info-level, non-fatal notices). */
export function opDiagnostic(code: OpCode, overrides: OpOverrides = {}): Diagnostic {
  const spec: OpSpec = CATALOG[code];
  const diag: Diagnostic = {
    code,
    domain: "operational",
    severity: spec.severity,
    title: spec.title,
    detail: overrides.detail ?? spec.detail,
    cause: spec.cause,
    remediation: spec.remediation,
  };
  if (spec.docsUrl) diag.docsUrl = spec.docsUrl;
  if (overrides.location) diag.location = overrides.location;
  if (overrides.meta) diag.meta = overrides.meta;
  return diag;
}

/** Build a throwable AppError for an operational code, with the correct exit code. */
export function opError(code: OpCode, overrides: OpOverrides = {}, cause?: unknown): AppError {
  return new AppError(opDiagnostic(code, overrides), CATALOG[code].exit, cause);
}

export function exitCodeFor(code: OpCode): ExitCode {
  return CATALOG[code].exit;
}
