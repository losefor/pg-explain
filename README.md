# pgexplain

Turn PostgreSQL `EXPLAIN (ANALYZE)` JSON into human-readable reports and detect plan anti-patterns — **every finding tells you what happened, why, and exactly how to fix it.**

[![npm version](https://img.shields.io/badge/npm-pgexplain-cb3837?logo=npm)](https://www.npmjs.com/package/pgexplain)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)

The npm package is `pgexplain`; the command it installs is `pg-explain`.

---

## Why pgexplain

Most EXPLAIN tools pretty-print the plan tree and stop there — you still have to know what a "lossy bitmap heap scan" or a 500× row misestimate *means* and what to do about it.

pgexplain goes further. It runs an **advisor** over the plan, flags anti-patterns by stable `PGX_*` code, and for each one prints three things:

- **What** happened (in plain language, with the real numbers from your plan).
- **Why** it matters.
- **Fix** — concrete steps and **copy-pasteable SQL/shell commands** (e.g. the exact `CREATE INDEX` or `ANALYZE` to run), plus a link to the relevant Postgres docs.

The same philosophy applies to operational errors: auth failures, timeouts, unreachable hosts, and malformed input all come back as actionable diagnostics rather than stack traces.

---

## Install

```sh
# global
pnpm add -g pgexplain      # or: npm install -g pgexplain

# one-off, no install
npx pgexplain plan.json
```

Requires **Node.js >= 22**. The package is **ESM-only**.

> The `pg` driver is an **optional dependency**. You only need it for `pg-explain run` (connecting to a live database). Analyzing a saved plan from a file or stdin needs no driver. If `pg` is missing when you run `run`, pgexplain tells you exactly how to install it (`PGX_PG_DRIVER_MISSING`).

---

## Quickstart

Analyze a saved plan and write a Markdown report (the headline deliverable):

```sh
pg-explain plan.json -o report.md -f markdown
```

Pipe a plan straight from psql or a file:

```sh
psql -XqAt -c "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <query>" | pg-explain
pg-explain < plan.json
```

Connect to a database, run EXPLAIN safely, and analyze the result in one step:

```sh
pg-explain run --query "SELECT * FROM orders WHERE status = 'shipped'" --dsn "$DATABASE_URL"
```

Point at a directory to analyze every plan in it (batch mode):

```sh
pg-explain ./plans/
```

Or launch the local **Studio** — a GUI for everything the CLI does:

```sh
pg-explain studio        # opens http://127.0.0.1:5177 in your browser
```

---

## Studio (local web UI)

`pg-explain studio` starts a local, single-user web app (binds `127.0.0.1`, no auth) that
mirrors the CLI with a friendlier surface. It ships inside the package, so `npx pgexplain studio`
just works — the PostgreSQL driver and the UI are only loaded on demand.

- **Analyze** a pasted `EXPLAIN (FORMAT JSON)` plan, or **Run** a query (connect → EXPLAIN-only,
  rollback-wrapped, read-only; non-`SELECT` refused unless forced).
- **Findings** as plain-language cards (what / why / fix + copy-paste commands + docs links).
- **Lock advisor** — static warnings (rewrites, missing `CONCURRENTLY`, unindexed `UPDATE/DELETE`,
  unbounded `FOR UPDATE`, …) plus a **🔒 Live locks** view of current blocking chains.
- Interactive **plan tree** (heat-colored by self-time), **bottlenecks**, raw JSON.
- **History** of every run (SQLite under `~/.pgexplain`), **Compare** any two runs (structured
  diff), and **Export** to Markdown / HTML / JSON.
- **Saved connections** and a **Settings** page to tune advisor thresholds (applied live).

Flags: `pg-explain studio [--port 5177] [--host 127.0.0.1] [--no-open] [--unsafe-host]`.
Binding a non-loopback host requires `--unsafe-host` (the studio can reach arbitrary databases,
so exposing it is an SSRF/credential risk). Set `PGEXPLAIN_DATA_DIR` to relocate the local store.

---

## Example output

Running pgexplain on a plan with a sequential scan over a large table:

```text
$ pg-explain test/fixtures/seq-scan-large.json --no-color

pg-explain report
Verdict: 2 warnings, 2 notes — top cost: Seq Scan on orders (78% of time). Total 321.0 ms.

Plan tree
Aggregate ▇▇▁▁▁▁▁▁  rows=1 · self 70.5 ms (22%) · cache 2%
└─ Seq Scan on orders ▇▇▇▇▇▇▁▁  rows=500,000 (est 1,000, 500× under) · self 250.0 ms (78%) · cache 2%

Bottlenecks (by self time)
  1. Seq Scan on orders — 250.0 ms (78%)
  2. Aggregate — 70.5 ms (22%)

Findings

[WARNING] Sequential scan on orders (500,000 rows) PGX_SEQ_SCAN_LARGE
  What: Postgres read orders sequentially, scanning roughly 500,000 rows.
  Why:  A row filter ((status = 'shipped'::text)) is applied after reading every row, so no index narrowed the scan.
  Fix:  Add an index covering the WHERE/JOIN predicate on orders so Postgres can skip non-matching rows. If the query genuinely needs most of the table, the seq scan is correct — reduce the rows touched instead.
        - Identify the selective columns in the WHERE/JOIN predicate.
        - Ensure they are sargable (no function-wrapping or implicit casts on the column).
        - If selectivity is low, a partial index (WHERE …) may be better.
        Index the predicate columns: CREATE INDEX ON orders (<predicate columns>) -- columns from the filter above;
        docs: https://www.postgresql.org/docs/current/indexes-intro.html

[WARNING] 500x row underestimate on orders PGX_ROW_MISESTIMATE
  What: Postgres estimated 1,000 rows but 500,000 were produced — a 500x underestimate on orders.
  Why:  The planner's row estimate is based on statistics that are stale, missing, or too coarse for this predicate (e.g. correlated columns the planner treats as independent).
  Fix:  Refresh and sharpen statistics for orders: run ANALYZE orders, raise per-column statistics targets on the predicate columns, and add extended statistics for correlated columns so the planner estimates rows correctly. Underestimates feeding a nested loop or hash join are the highest priority — fix these first.
        - Refresh table statistics first; this alone often fixes the estimate.
        - If the column has a skewed/uneven distribution, raise its statistics target and re-ANALYZE.
        - If the predicate spans multiple correlated columns, create extended statistics so the planner stops assuming independence.
        Refresh statistics: ANALYZE orders;
        Raise per-column statistics target: ALTER TABLE orders ALTER COLUMN <column> SET STATISTICS 1000;
ANALYZE orders;
        Add extended statistics for correlated columns: CREATE STATISTICS <stats_name> (dependencies, ndistinct) ON <col_a>, <col_b> FROM orders;
ANALYZE orders;
        docs: https://www.postgresql.org/docs/current/planner-stats.html

[NOTE] Low cache hit ratio at Aggregate (2.3%) PGX_LOW_CACHE_HIT
  What: Aggregate served only 2.3% of its shared-buffer accesses from cache, reading 5,000 blk (39.1 MiB) from disk.
  Why:  The pages this node needed were not resident in shared_buffers, so PostgreSQL had to read them from disk. On a first run this is an expected cold cache; if it persists, the working set is larger than the cache or the scan touches more pages than necessary.
  Fix:  Re-run the query to check whether this is just a cold cache — the ratio should climb on a warm run. If it stays low, the working set exceeds shared_buffers: size shared_buffers/effective_cache_size to your RAM, or add a selective index on the scanned relation so far fewer pages are read.
        - Run the same EXPLAIN (ANALYZE, BUFFERS) a second time; a much higher hit ratio means the first run was a cold cache and no action is needed.
        - If the ratio stays low, check whether shared_buffers (and effective_cache_size for planner costing) are sized to the machine's RAM.
        - If the node reads far more pages than the rows it returns, add a selective index so only matching pages are fetched.
        Inspect current buffer-cache sizing: SHOW shared_buffers; SHOW effective_cache_size;
        Reduce pages read with a selective index: CREATE INDEX ON <table> (<predicate columns>);
        docs: https://www.postgresql.org/docs/current/runtime-config-resource.html#GUC-SHARED-BUFFERS

[NOTE] Low cache hit ratio at Seq Scan on orders (2.3%) PGX_LOW_CACHE_HIT
  What: Seq Scan on orders served only 2.3% of its shared-buffer accesses from cache, reading 5,000 blk (39.1 MiB) from disk.
  Why:  The pages this node needed were not resident in shared_buffers, so PostgreSQL had to read them from disk. On a first run this is an expected cold cache; if it persists, the working set is larger than the cache or the scan touches more pages than necessary.
  Fix:  Re-run the query to check whether this is just a cold cache — the ratio should climb on a warm run. If it stays low, the working set exceeds shared_buffers: size shared_buffers/effective_cache_size to your RAM, or add a selective index on orders so far fewer pages are read.
        - Run the same EXPLAIN (ANALYZE, BUFFERS) a second time; a much higher hit ratio means the first run was a cold cache and no action is needed.
        - If the ratio stays low, check whether shared_buffers (and effective_cache_size for planner costing) are sized to the machine's RAM.
        - If the node reads far more pages than the rows it returns, add a selective index so only matching pages are fetched.
        Inspect current buffer-cache sizing: SHOW shared_buffers; SHOW effective_cache_size;
        Reduce pages read with a selective index: CREATE INDEX ON orders (<predicate columns>);
        docs: https://www.postgresql.org/docs/current/runtime-config-resource.html#GUC-SHARED-BUFFERS

Total execution time: 321.0 ms
```

(In a real terminal the tree uses color, severity heat, and proportional self-time bars.)

---

## Commands

| Command | What it does |
| --- | --- |
| `pg-explain [FILE]` | **Analyze** a plan from a file, `< stdin`, or every plan in a directory (batch mode). This is the default command. |
| `pg-explain run` | **Connect** to PostgreSQL, run `EXPLAIN` safely, and analyze the result. Needs the optional `pg` driver. |
| `pg-explain diff <before> <after>` | **Compare** two plan JSON files and report regressions. Designed as a CI gate. |
| `pg-explain completion <bash\|zsh\|fish>` | Print a shell **completion** script for the given shell. |

Run `pg-explain --help`, `pg-explain run --help`, or `pg-explain diff --help` for the full flag list.

### `pg-explain run` (selected flags)

| Flag | Purpose |
| --- | --- |
| `--dsn` / `--host` `--port` `-d/--dbname` `-U/--user` | Connection target (or `PG*` env vars). |
| `--query` / `--file` | SQL to explain (a string or a `.sql` file). |
| `--statement <n>` | 1-based statement index when the file holds several. |
| `--param <v>` | Value for `$1`, `$2`, … (repeatable). |
| `--sslmode` `--sslrootcert` | `disable \| require \| verify-ca \| verify-full` and a CA bundle. |
| `--connect-timeout` `--statement-timeout` `--lock-timeout` | Time budgets (default `10s` / `30s` / `5s`). |
| `--force` | Allow a non-SELECT to execute (still auto-rolled-back). |
| `--no-rollback` | Do **not** wrap the run in a rolled-back transaction (dangerous). |
| `--no-analyze` | Plan estimates only — the query never executes. |
| `--no-buffers` `--explain-verbose` `--settings` `--wal` `--generic-plan` `--no-timing` `--no-costs` | Toggle individual EXPLAIN options. |
| `--compat` | Auto-omit EXPLAIN options the server is too old for. |

---

## Output formats

Choose with `-f`/`--format` (default `terminal`); write to a file with `-o`/`--output`.

| Format | Notes |
| --- | --- |
| `terminal` | Color, severity heat, and proportional self-time bars for interactive use. |
| `markdown` | The headline shareable deliverable — paste into a PR or ticket. |
| `json` | Stable, machine-readable (`schemaVersion = 1`). |
| `html` | Single self-contained file (no external assets). Auto-opens in your browser when run interactively. |
| `text` | Plain text, no escapes — good for logs. |

`diff` supports `terminal`, `markdown`, and `json`.

When you run `-f html` in an interactive terminal, the report opens in your default browser automatically: with `-o report.html` that file is opened, otherwise a temp file is written and opened. Auto-open is off when output is piped/redirected or `CI` is set; use `--open` to force it (e.g. into a file in CI) and `--no-open` to disable it.

```bash
pg-explain plan.json -f html -o report.html   # writes the file and opens it
pg-explain plan.json -f html                   # writes a temp file and opens it
pg-explain plan.json -f html > report.html     # redirected → no open, HTML to stdout
```

Shared output flags: `--tldr` (summary + findings, no plan tree), `--redact` (strip literal values so the report is safe to share), `--open` / `--no-open` (HTML browser opening), `--ascii` (ASCII tree glyphs), `--color auto|always|never` / `--no-color`, `--compact` (compact JSON), `--config <path>`, `-q/--quiet`, `--verbose`, `--debug`.

---

## Safety

`EXPLAIN ANALYZE` **executes the query**, so pgexplain is conservative by default when talking to a live database:

- **Auto-rollback.** Every `run` is wrapped in a transaction that is **always rolled back** (`BEGIN … ROLLBACK`), so nothing is committed. Opt out only with `--no-rollback`.
- **Read-only by default.** A data-modifying statement (`INSERT`/`UPDATE`/`DELETE`/`MERGE`/DDL) is **refused** (`PGX_NON_SELECT_REFUSED`) unless you pass `--force` — and even then it runs inside the rolled-back transaction. Or drop ANALYZE (`--no-analyze`) for an estimate-only plan that never runs.
- **Timeouts.** `statement_timeout` and `lock_timeout` are set on the session (`--statement-timeout`, `--lock-timeout`) so a runaway query or a lock wait can't hang.
- **Credential scrubbing.** Connection strings, passwords, and other secrets are scrubbed from **all** output, including error messages and `--debug` stack traces.
- **`--redact`.** Strips literal values from expressions before analysis so a shared report leaks no data.

---

## The advisor

The advisor ships **18 rules**, each identified by a stable, greppable `PGX_*` code (the rule id is the diagnostic code, and the config key). They run in roughly most-actionable-first order:

| Code | Flags when… |
| --- | --- |
| `PGX_CARTESIAN_PRODUCT` | A nested loop has no join condition (accidental cross join). |
| `PGX_SEQ_SCAN_LARGE` | A sequential scan reads a large table that an index could narrow. |
| `PGX_NESTED_LOOP_LARGE_OUTER` | A nested loop is driven by a large outer side (re-probes inner repeatedly). |
| `PGX_HIGH_FILTER_DISCARD` | A node reads many rows then discards most of them via a filter. |
| `PGX_LIMIT_LARGE_OFFSET` | A `LIMIT` discards a large generated prefix (OFFSET pagination — use keyset). |
| `PGX_SORT_SPILL_DISK` | A sort spilled to disk instead of staying in `work_mem`. |
| `PGX_HASH_SPILL_DISK` | A hash join's build side spilled to disk (multiple batches). |
| `PGX_MEMOIZE_EVICTIONS` | A Memoize cache is thrashing (evictions outpace hits, or entries overflow `work_mem`). |
| `PGX_CORRELATED_SUBPLAN` | A correlated subplan is re-executed once per outer row. |
| `PGX_ROW_MISESTIMATE` | Estimated vs actual row counts diverge sharply (stale/missing stats). |
| `PGX_FILTER_COULD_BE_INDEX_COND` | A residual filter could be pushed into an index condition. |
| `PGX_COULD_BE_INDEX_ONLY` | An index scan could become index-only with a covering index. |
| `PGX_INDEX_ONLY_HEAP_FETCHES` | An index-only scan still did many heap fetches (visibility map cold). |
| `PGX_BITMAP_LOSSY` | A bitmap heap scan went lossy (rechecks whole pages; `work_mem` too small). |
| `PGX_WORKERS_NOT_LAUNCHED` | Parallel workers were planned but not all launched. |
| `PGX_LOW_CACHE_HIT` | A node's shared-buffer cache hit ratio is low (heavy disk reads). |
| `PGX_SIGNIFICANT_JIT` | JIT compilation consumed a significant share of execution time. |
| `PGX_TRIGGER_TIME` | Triggers consumed a significant share of execution time. |

Every finding includes the *what / why / fix* triad shown in the example above. Rules can be tuned or disabled per project (see [Config](#config-file)).

One additional check runs only on the `run` path (it needs a live connection, not just a plan): `PGX_STALE_STATISTICS` flags tables in the plan that were never analyzed or have churned past `staleStatsModRatio` (default 20%) since their last ANALYZE — the most common root cause behind `PGX_ROW_MISESTIMATE`. It is configured like any other rule.

> pgexplain also has an **operational error catalog** of stable `PGX_*` codes — auth failures, unreachable hosts, SSL problems, timeouts, malformed/empty input, missing driver, and more — each with a title, cause, remediation, and Postgres docs link.

---

## CI usage

pgexplain is built to gate pull requests on plan health.

**Fail when a finding is too severe:**

```sh
# exit 1 if any finding at or above the given severity exists
pg-explain plan.json --fail-on warn

# shorthand for --fail-on warn
pg-explain plan.json --strict
```

`--fail-on` takes `info`, `warn`, or `error`. Findings alone never change the exit code unless `--strict`/`--fail-on` is set.

**Fail on regressions between two plans:**

```sh
# exit 1 if execution time regresses by >= 20%, or if any new finding appears
pg-explain diff before.json after.json \
  --fail-on-slower 20 \
  --fail-on-new-findings
```

Branch on the **kind** of failure without parsing text:

| Exit | Meaning |
| --- | --- |
| `0` | Success — report produced. |
| `1` | CI gate tripped (`--strict` / `--fail-on`, or a `diff` gate). |
| `2` | Usage error (bad flags, refused non-SELECT, unsupported EXPLAIN option). |
| `3` | Input error (empty stdin and no file, or an unreadable file). |
| `4` | Parse error (not valid EXPLAIN JSON, or the wrong shape). |
| `5` | Database error (connect / auth / permission / timeout / cancel). |
| `70` | Internal error — a bug in pgexplain. |
| `130` | Interrupted by SIGINT. |

---

## Config file

pgexplain reads, in order, `.pgexplainrc.json`, `.pgexplainrc`, or a `pgExplain` key in `package.json` (override with `--config <path>`). Tune thresholds and enable/disable or re-severity individual rules by code:

```jsonc
{
  "thresholds": {
    // numeric knobs the rules read (e.g. minimum rows for a "large" seq scan)
  },
  "rules": {
    "PGX_SEQ_SCAN_LARGE": { "severity": "error" },
    "PGX_LOW_CACHE_HIT":   { "enabled": false }
  }
}
```

Each rule entry accepts `{ "enabled": boolean, "severity": "error" | "warn" | "info" }`.

---

## Library usage

pgexplain is also a typed library (ESM):

```ts
import { analyze, render } from "pgexplain";

const explainJson = await fs.readFile("plan.json", "utf8");

const result = analyze(explainJson, { redact: true });
// result.diagnostics — findings with code/severity/what-why-fix
// result.worstSeverity — "error" | "warn" | "info" | null

const markdown = render(result, { format: "markdown" });
console.log(markdown);
```

`analyze(input, options?)` parses the EXPLAIN JSON, optionally redacts literals, computes metrics, and runs the advisor. `render(result, options?)` emits any supported format. Other exports include `runAdvisor`, `parseExplainJson`, `computeMetrics`, `DEFAULT_CONFIG`, `FORMATS`, `JSON_SCHEMA_VERSION`, `ExitCode`, and the full type set.

For finer control — e.g. custom thresholds or gating a deploy script on severity:

```ts
import { analyze, DEFAULT_CONFIG, severityAtLeast } from "pgexplain";

const result = analyze(explainJson, {
  config: {
    ...DEFAULT_CONFIG,
    thresholds: { ...DEFAULT_CONFIG.thresholds, seqScanRows: 10_000 },
    rules: { PGX_LOW_CACHE_HIT: { enabled: false } },
  },
});

if (result.worstSeverity && severityAtLeast(result.worstSeverity, "warn")) {
  process.exit(1); // same behaviour as `pg-explain --fail-on warn`
}
```

---

## Exit codes

See the [CI usage](#ci-usage) table above — `0` success, `1` CI gate, `2` usage, `3` input, `4` parse, `5` database, `70` internal, `130` SIGINT. These are stable; scripts can branch on them directly.

---

## Contributing

This project uses **pnpm 9** and **Node >= 22**.

```sh
pnpm install
pnpm build        # tsup
pnpm test         # vitest
pnpm lint         # biome
pnpm typecheck    # tsc --noEmit
```

Issues and pull requests are welcome at <https://github.com/OWNER/pgexplain>.

---

## License

MIT © 2026 pgexplain contributors. See [LICENSE](./LICENSE).
