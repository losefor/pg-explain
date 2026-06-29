# pgexplain examples

Real, committed output from the `pg-explain` CLI so you can see what a report looks
like before installing anything. Each report in this directory was generated from a
fixture plan in [`plans/`](./plans) by the built CLI (`dist/cli.js`).

## What's here

| File | What it is |
| --- | --- |
| [`plans/seq-scan-large.json`](./plans/seq-scan-large.json) | An `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plan with a large sequential scan and a big row underestimate. |
| [`plans/sort-spill-disk.json`](./plans/sort-spill-disk.json) | A plan whose Sort spilled to disk, on top of a seq scan and a row overestimate. |
| [`seq-scan.report.txt`](./seq-scan.report.txt) | The default terminal report for `seq-scan-large.json`, with color stripped (`--no-color`). |
| [`seq-scan.report.md`](./seq-scan.report.md) | The same analysis rendered as Markdown (`-f markdown`) — paste-ready for a PR comment or issue. |
| [`sort-spill.report.html`](./sort-spill.report.html) | A self-contained HTML report for `sort-spill-disk.json` (`-f html`) — open it in a browser. |
| [`.pgexplainrc.json`](./.pgexplainrc.json) | A sample config showing every threshold and per-rule severity/enable override. |

## The example reports

### `seq-scan.report.txt` / `seq-scan.report.md`

Both come from the same plan (`plans/seq-scan-large.json`). The analysis surfaces:

- **`PGX_SEQ_SCAN_LARGE`** — a sequential scan over ~500,000 rows of `orders`, with a
  filter applied after every row was read (no index narrowed the scan).
- **`PGX_ROW_MISESTIMATE`** — the planner expected 1,000 rows but got 500,000 (a 500x
  underestimate), which is exactly the kind of stale-statistics problem that leads the
  planner into bad join choices.

The `.txt` version is what you get by default in a terminal; the `.md` version is the
same content as GitHub-flavored Markdown (summary table, fenced plan tree, finding
sections) for dropping into a PR or ticket.

### `sort-spill.report.html`

From `plans/sort-spill-disk.json`. A standalone HTML page (inline CSS, no external
assets — open it directly) reporting:

- **`PGX_SORT_SPILL_DISK`** — the Sort spilled ~180 MiB to disk because `work_mem`
  was too small to sort in memory.
- **`PGX_SEQ_SCAN_LARGE`** — a 2,000,000-row sequential scan feeding the sort.
- **`PGX_ROW_MISESTIMATE`** — a large row overestimate (reported as a note here).

## The sample config (`.pgexplainrc.json`)

`pg-explain` auto-loads a `.pgexplainrc.json` (or `.pgexplainrc`) from the current
directory, or a `pgExplain` key in `package.json`. You can also point at one explicitly
with `--config`. The sample shows the two things you can tune:

- **`thresholds`** — when each rule fires (the values shown are the built-in defaults).
- **`rules`** — per-rule overrides keyed by the `PGX_*` rule code. Each entry may set
  `"enabled": false` to silence a rule and/or `"severity"` (`"error"` | `"warn"` |
  `"info"`) to re-rank it. The rule codes come straight from
  [`src/advisor/rules/index.ts`](../src/advisor/rules/index.ts).

Try it against an example:

```sh
pg-explain examples/plans/seq-scan-large.json --config examples/.pgexplainrc.json
```

With the sample config, `PGX_SEQ_SCAN_LARGE` and `PGX_ROW_MISESTIMATE` are promoted to
`error`, so this would fail a `--fail-on error` CI gate.

## Regenerating these files

The reports are committed as static examples. To regenerate them after a change, build
the CLI and re-run the commands from the repo root:

```sh
# 1. Build (creates dist/) if it isn't there yet
pnpm build

# 2. Refresh the fixture copies (the source of truth lives in test/fixtures/)
cp test/fixtures/seq-scan-large.json examples/plans/
cp test/fixtures/sort-spill-disk.json examples/plans/

# 3. Regenerate the reports
node dist/cli.js test/fixtures/seq-scan-large.json --no-color    > examples/seq-scan.report.txt
node dist/cli.js test/fixtures/seq-scan-large.json -f markdown   > examples/seq-scan.report.md
node dist/cli.js test/fixtures/sort-spill-disk.json -f html      > examples/sort-spill.report.html
```

Useful flags when exploring (run `pg-explain --help` for the full list):

- `-f, --format` — `terminal` | `markdown` | `json` | `html` | `text`
- `--no-color` / `--color auto|always|never` — control ANSI color
- `--tldr` — summary and findings only, no plan tree
- `--redact` — strip literal values from expressions (safe to share)
- `--ascii` — ASCII tree glyphs instead of Unicode
- `--fail-on info|warn|error` (or `--strict`) — CI gate: exit non-zero on findings at/above that level
- `--config <path>` — use a specific config file
