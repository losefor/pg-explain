# Changelog

## 0.3.0

### Minor Changes

- 5a1be66: - **New rule `PGX_MEMOIZE_EVICTIONS`**: flags a thrashing Memoize cache (evictions outpacing hits, or cache overflows) with a `work_mem` / `hash_mem_multiplier` remediation. The parser now normalizes Memoize cache counters (`Cache Hits/Misses/Evictions/Overflows`).
  - **Studio component tests**: React Testing Library + happy-dom cover FindingCard, the side-by-side DiffPanel, and toasts; the web test project runs in CI via `pnpm test`.
  - **Fix `PGX_CARTESIAN_PRODUCT` false positive**: the rule now looks through Memoize/Materialize to the real inner scan, so `Nested Loop → Memoize → Index Scan (parameterized)` is no longer misreported as a cross join.
- 5a1be66: New analysis capabilities:

  - **New rule `PGX_LIMIT_LARGE_OFFSET`**: flags OFFSET-style pagination where the plan generates and discards a large row prefix; recommends keyset pagination. Tunable via `limitDiscardRows`.
  - **New check `PGX_STALE_STATISTICS`** (run path only): flags tables in the plan that were never analyzed or churned past `staleStatsModRatio` (default 20%) since their last ANALYZE — the usual root cause behind row misestimates.
  - **New command `pg-explain locks`**: live lock-contention snapshot (who is blocked, by whom, for how long) with cancel/terminate remediation; `--fail-on-blocked` exits 1 for scripting; terminal and JSON output.
  - **Studio: side-by-side plan diff** — the diff view now renders both plan trees with slower/faster/added/removed nodes highlighted.
  - **Studio: shareable run URLs** — every stored run gets a `#run=<id>` deep link plus a copy-link button.
  - Shell completion now includes the `locks` and `studio` subcommands.

### Patch Changes

- 5a1be66: Studio & DX quality pass:

  - Studio: toast notifications — export failures and settings saves are no longer silent
  - Studio: keyboard shortcuts (⌘/Ctrl+K focus editor, ⇧⌘/Ctrl+F format SQL, `?` help overlay) and ARIA tablist/landmark roles
  - Studio: collapsible sidebar and history filter box
  - Library: export `severityAtLeast` for CI-gate scripting; README library examples expanded
  - Tests: snapshot coverage for all five render formats, command-flow tests for `analyze`/`diff` exit codes, and a new `web` vitest project covering studio helpers
  - Dev: `pnpm dev:studio` runs core rebuild + API restart + Vite HMR in one terminal

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-29

Initial release.

### Added

- **`analyze`** (the default command): read a PostgreSQL `EXPLAIN (ANALYZE)`
  plan from a file or stdin and produce a human-readable report. Point it at a
  directory to analyze every plan in batch.
- **`run`**: connect to PostgreSQL, run `EXPLAIN` safely, and analyze the
  result. Execution is wrapped in an auto-rolled-back, read-only transaction
  with `statement_timeout` and `lock_timeout`; non-`SELECT` statements are
  refused without `--force`. The `pg` driver is an optional, lazy-loaded
  dependency.
- **`diff`**: compare two plans (`before` → `after`) and report regressions,
  with CI gates via `--fail-on-slower` and `--fail-on-new-findings`.
- **`completion`**: print a shell completion script for bash, zsh, or fish.
- **16 advisor rules** with stable, greppable `PGX_*` codes: sequential scan on
  a large table, nested loop with a large outer, high filter discard, sort
  spill to disk, hash spill to disk, index-only heap fetches, lossy bitmap,
  workers not launched, could-be-index-only, filter-could-be-index-condition,
  correlated subplan, cartesian product, significant JIT time, trigger time,
  row misestimate, and low cache hit ratio.
- **Actionable diagnostics**: every advisor finding and every operational error
  tells you what happened, why, and exactly how to fix it — including
  copy-pasteable SQL and shell commands and a link to the relevant PostgreSQL
  docs. Operational errors come from a stable `PGX_*` catalog.
- **5 output formats**: terminal (color, heat, bars), markdown, json (stable,
  `schemaVersion` 1), html (self-contained), and text. Controlled with
  `-f/--format`, `-o/--output`, `--tldr`, `--redact`, `--ascii`,
  `--color`/`--no-color`, and CI gates (`--fail-on`, `--strict`).
- **Safety wrapper**: credentials are scrubbed from all output; EXPLAIN ANALYZE
  runs in a rolled-back, read-only transaction with timeouts; non-`SELECT` is
  refused without `--force`; `--redact` strips literal values; no telemetry.
- **Configuration**: tune thresholds and per-rule `enabled`/`severity` via
  `.pgexplainrc.json`, `.pgexplainrc`, or a `pgExplain` key in `package.json`.
- **Programmatic library API**: `import { analyze, render } from "pgexplain"`.
- **Stable exit codes** so scripts and CI can branch on the kind of failure:
  `0` success, `1` CI gate tripped, `2` usage, `3` input, `4` parse,
  `5` database, `70` internal, `130` interrupted.

[Unreleased]: https://github.com/OWNER/pgexplain/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/pgexplain/releases/tag/v0.1.0
