# Changelog

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
