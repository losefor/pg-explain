# Security Policy

## Supported versions

pgexplain is pre-1.0. Security fixes are applied to the latest released minor
version. Please always run the most recent `0.x` release.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report it privately by email to **security@example.com**. Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal plan, command, or config is ideal),
- the pgexplain version (`pg-explain --version`) and your environment.

We will acknowledge your report, work with you on a fix, and credit you in the
release notes if you wish. Please give us a reasonable opportunity to address
the issue before any public disclosure.

## Security posture

pgexplain is built to be safe to point at production databases and safe to share
its output. Its design guarantees:

- **Credentials are scrubbed from all output.** Connection strings, passwords,
  and other secrets are stripped from every report, error message, and (under
  `--debug`) stack trace before anything is printed.
- **EXPLAIN runs inside a rolled-back, read-only transaction.** The `run`
  command wraps execution as `BEGIN … ROLLBACK` with `statement_timeout` and
  `lock_timeout` set, so nothing is committed and runaway queries are bounded.
- **Data-modifying statements are refused by default.** Because
  `EXPLAIN ANALYZE` actually executes the query, a non-`SELECT`
  (INSERT/UPDATE/DELETE/MERGE/DDL) is refused unless you pass `--force` — and
  even then it still runs inside the auto-rolled-back transaction.
- **`--redact` strips literal values** from expressions so plans can be shared
  without leaking the data embedded in predicates.
- **No telemetry.** pgexplain never phones home; it makes no network calls
  except the PostgreSQL connection you explicitly ask for with `run`.

If you believe any of these guarantees can be bypassed, that is a security issue
— please report it via the process above.
