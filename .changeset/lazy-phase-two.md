---
"pgexplain": minor
---

New analysis capabilities:

- **New rule `PGX_LIMIT_LARGE_OFFSET`**: flags OFFSET-style pagination where the plan generates and discards a large row prefix; recommends keyset pagination. Tunable via `limitDiscardRows`.
- **New check `PGX_STALE_STATISTICS`** (run path only): flags tables in the plan that were never analyzed or churned past `staleStatsModRatio` (default 20%) since their last ANALYZE — the usual root cause behind row misestimates.
- **New command `pg-explain locks`**: live lock-contention snapshot (who is blocked, by whom, for how long) with cancel/terminate remediation; `--fail-on-blocked` exits 1 for scripting; terminal and JSON output.
- **Studio: side-by-side plan diff** — the diff view now renders both plan trees with slower/faster/added/removed nodes highlighted.
- **Studio: shareable run URLs** — every stored run gets a `#run=<id>` deep link plus a copy-link button.
- Shell completion now includes the `locks` and `studio` subcommands.
