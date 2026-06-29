# Contributing to pgexplain

Thanks for your interest in improving **pgexplain** — the tool that turns
PostgreSQL `EXPLAIN (ANALYZE)` JSON into human-readable reports and flags plan
anti-patterns, where **every finding tells you what happened, why, and exactly
how to fix it**.

This guide covers local setup, the project scripts, how to add a new advisor
rule, and our commit / changelog conventions.

## Prerequisites

- **Node.js >= 22** (the project is ESM-only and uses native TypeScript types).
- **pnpm 9** — this is the only supported package manager. Install it with
  `corepack enable && corepack prepare pnpm@9 --activate` (the exact pinned
  version lives in `package.json` under `packageManager`).
- **Docker** — only required to run the integration test suite, which spins up a
  real PostgreSQL container via Testcontainers.

## Setup

```bash
pnpm install
```

That installs all dependencies, including the dev toolchain. The PostgreSQL
driver (`pg`) is an **optional dependency** and is lazy-loaded only by the `run`
command, so plan-only analysis from a file or stdin works without it.

## Scripts

All scripts are run with `pnpm <script>`:

| Script                   | What it does                                                            |
| ------------------------ | ---------------------------------------------------------------------- |
| `pnpm build`             | Bundle the library and CLI with **tsup** into `dist/`.                  |
| `pnpm dev`               | Rebuild on change (`tsup --watch`).                                     |
| `pnpm typecheck`         | Type-check the whole project with `tsc --noEmit`.                       |
| `pnpm lint`              | Lint and check formatting with **biome** (`biome check .`).            |
| `pnpm lint:fix`          | Apply biome's safe fixes (`biome check --write .`).                     |
| `pnpm format`            | Format with biome (`biome format --write .`).                          |
| `pnpm test`              | Run the **unit** test suite with **vitest**.                            |
| `pnpm test:watch`        | Run vitest in watch mode.                                               |
| `pnpm test:cov`          | Run the unit suite with V8 coverage.                                    |
| `pnpm test:integration`  | Run the **integration** suite — **requires Docker** (Testcontainers).  |
| `pnpm smoke`             | Quick sanity check: `node dist/cli.js --version` (needs a build first). |

Before opening a pull request, make sure the same checks `prepublishOnly` runs
pass locally:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

## Adding an advisor rule

Advisor rules are the heart of pgexplain. Each rule is a small, self-contained
unit that inspects plan nodes and emits **actionable findings**. The rule id
*is* the `PGX_*` diagnostic code — it is greppable and used as the config key.

Use [`src/advisor/rules/seq-scan-large.ts`](src/advisor/rules/seq-scan-large.ts)
as your template. It shows the whole shape: a `Rule` object with an `id`, a
`title`, a `defaultSeverity`, and a `check(node, ctx)` method that returns an
array of findings built with the `makeFinding` helper.

Adding a rule is four steps:

1. **Write the rule** — one file in `src/advisor/rules/`, e.g.
   `src/advisor/rules/my-rule.ts`. Export a `Rule` whose `id` is a new
   `PGX_*` code. Build findings with `makeFinding` (from `./util.ts`) so they
   carry a `title`, `detail`, `cause`, a `remediation` (summary + optional
   steps + copy-pasteable `commands` with `sql`/`shell`), and a `docsUrl`.
   **Every finding must be actionable** — that is the project's core promise.
   Respect `ctx.thresholds` for any numeric cutoffs (defined in
   `src/config.ts` / `DEFAULT_THRESHOLDS`) so users can tune them.

2. **Register it** — import and add your rule to the `ALL_RULES` array in
   [`src/advisor/rules/index.ts`](src/advisor/rules/index.ts). The array order
   is the display order (most actionable structural issues first), so place it
   where it belongs.

3. **Add a fixture** — drop a representative `EXPLAIN (FORMAT JSON)` plan in
   `test/fixtures/`, named after your rule (e.g.
   `test/fixtures/my-rule.json`). Include a negative fixture too if your rule
   needs one to prove it does *not* over-fire (see `small-seq-scan.json`).

4. **Add a test** — a test file in `test/unit/rules/`, e.g.
   `test/unit/rules/my-rule.test.ts`. Use the helpers in
   `test/unit/helpers.ts` (`loadTree`, `runRule`, `ctxFor`) — see
   [`test/unit/rules/seq-scan-large.test.ts`](test/unit/rules/seq-scan-large.test.ts)
   for the pattern. Assert the code, the severity, the location, and — crucially
   — that the remediation is present and the fix command / docs URL are right.

If your rule introduces a new tunable threshold, add it to
`DEFAULT_THRESHOLDS` in `src/config.ts`. Users can override any rule's
`enabled`/`severity` and any threshold via `.pgexplainrc.json`,
`.pgexplainrc`, or a `pgExplain` key in `package.json`.

### Operational error codes

Diagnostics that describe *operational* problems (connection failures, bad
input, refused statements, etc.) live in the catalog at
[`src/diagnostics/catalog.ts`](src/diagnostics/catalog.ts). Like advisor
findings, every entry carries a title, cause, remediation, and docs URL, and
maps to a stable exit code. Add to the catalog rather than throwing ad-hoc
errors.

## Test & fixture conventions

- **Unit tests** live under `test/unit/**` and run with `pnpm test`. They must
  not touch the network or a database.
- **Integration tests** live under `test/integration/**`, run with
  `pnpm test:integration`, and need **Docker** (they boot a real PostgreSQL via
  Testcontainers). They have a generous timeout because containers are slow to
  start.
- **Fixtures** are real `EXPLAIN (FORMAT JSON)` plans under `test/fixtures/`,
  named after the rule or scenario they exercise. Load them with
  `loadTree(...)` from `test/unit/helpers.ts`.
- Coverage is gated on `src/core/**`, `src/advisor/**`, and
  `src/diagnostics/**`. Keep new code in those areas covered.

## Commits & changesets

- We use **[Conventional Commits](https://www.conventionalcommits.org/)** for
  commit messages (e.g. `feat: add lossy bitmap rule`,
  `fix: scrub DSN from connection errors`, `docs: ...`).
- We manage versioning and the changelog with
  **[changesets](https://github.com/changesets/changesets)**. Any
  user-facing change needs a changeset:

  ```bash
  pnpm changeset
  ```

  Pick the appropriate semver bump and write a short, user-facing summary. The
  generated file goes in your pull request.

## Pull requests

Before you open a PR:

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` all pass.
- New behavior has tests (and fixtures, for rules).
- User-facing changes include a changeset.
- New advisor findings and operational errors are **actionable** — they say
  what, why, and how to fix.

Thank you for contributing!
