---
"pgexplain": minor
---

- **New rule `PGX_MEMOIZE_EVICTIONS`**: flags a thrashing Memoize cache (evictions outpacing hits, or cache overflows) with a `work_mem` / `hash_mem_multiplier` remediation. The parser now normalizes Memoize cache counters (`Cache Hits/Misses/Evictions/Overflows`).
- **Studio component tests**: React Testing Library + happy-dom cover FindingCard, the side-by-side DiffPanel, and toasts; the web test project runs in CI via `pnpm test`.
- **Fix `PGX_CARTESIAN_PRODUCT` false positive**: the rule now looks through Memoize/Materialize to the real inner scan, so `Nested Loop → Memoize → Index Scan (parameterized)` is no longer misreported as a cross join.
