# pg-explain report

> **Verdict:** 2 warnings, 2 notes — top cost: Seq Scan on orders (78% of time). Total 321.0 ms.

## Summary

| Metric | Value |
| --- | --- |
| Planning time | 0.420 ms |
| Execution time | 321.0 ms |
| Findings | 0 critical, 2 warning(s), 2 note(s) |

## Plan tree

```
Aggregate  —  rows=1 · self 70.5 ms (22%) · cache 2%
└─ Seq Scan on orders  —  rows=500,000 (est 1,000, 500× under) · self 250.0 ms (78%) · cache 2%
```

## Bottlenecks (by self time)

| # | Node | Self time | % of total | Rows |
| --- | --- | --- | --- | --- |
| 1 | Seq Scan on orders | 250.0 ms | 77.9% | 500,000 |
| 2 | Aggregate | 70.5 ms | 22.0% | 1 |

## Findings

### 🟠 Warning — Sequential scan on orders (500,000 rows)

`PGX_SEQ_SCAN_LARGE`

**What:** Postgres read orders sequentially, scanning roughly 500,000 rows.

**Why:** A row filter ((status = 'shipped'::text)) is applied after reading every row, so no index narrowed the scan.

**Fix:** Add an index covering the WHERE/JOIN predicate on orders so Postgres can skip non-matching rows. If the query genuinely needs most of the table, the seq scan is correct — reduce the rows touched instead.

- Identify the selective columns in the WHERE/JOIN predicate.
- Ensure they are sargable (no function-wrapping or implicit casts on the column).
- If selectivity is low, a partial index (WHERE …) may be better.

_Index the predicate columns:_
```sql
CREATE INDEX ON orders (<predicate columns>) -- columns from the filter above;
```

📖 [PostgreSQL docs](https://www.postgresql.org/docs/current/indexes-intro.html)

### 🟠 Warning — 500x row underestimate on orders

`PGX_ROW_MISESTIMATE`

**What:** Postgres estimated 1,000 rows but 500,000 were produced — a 500x underestimate on orders.

**Why:** The planner's row estimate is based on statistics that are stale, missing, or too coarse for this predicate (e.g. correlated columns the planner treats as independent).

**Fix:** Refresh and sharpen statistics for orders: run ANALYZE orders, raise per-column statistics targets on the predicate columns, and add extended statistics for correlated columns so the planner estimates rows correctly. Underestimates feeding a nested loop or hash join are the highest priority — fix these first.

- Refresh table statistics first; this alone often fixes the estimate.
- If the column has a skewed/uneven distribution, raise its statistics target and re-ANALYZE.
- If the predicate spans multiple correlated columns, create extended statistics so the planner stops assuming independence.

_Refresh statistics:_
```sql
ANALYZE orders;
```

_Raise per-column statistics target:_
```sql
ALTER TABLE orders ALTER COLUMN <column> SET STATISTICS 1000;
ANALYZE orders;
```

_Add extended statistics for correlated columns:_
```sql
CREATE STATISTICS <stats_name> (dependencies, ndistinct) ON <col_a>, <col_b> FROM orders;
ANALYZE orders;
```

📖 [PostgreSQL docs](https://www.postgresql.org/docs/current/planner-stats.html)

### 🔵 Note — Low cache hit ratio at Aggregate (2.3%)

`PGX_LOW_CACHE_HIT`

**What:** Aggregate served only 2.3% of its shared-buffer accesses from cache, reading 5,000 blk (39.1 MiB) from disk.

**Why:** The pages this node needed were not resident in shared_buffers, so PostgreSQL had to read them from disk. On a first run this is an expected cold cache; if it persists, the working set is larger than the cache or the scan touches more pages than necessary.

**Fix:** Re-run the query to check whether this is just a cold cache — the ratio should climb on a warm run. If it stays low, the working set exceeds shared_buffers: size shared_buffers/effective_cache_size to your RAM, or add a selective index on the scanned relation so far fewer pages are read.

- Run the same EXPLAIN (ANALYZE, BUFFERS) a second time; a much higher hit ratio means the first run was a cold cache and no action is needed.
- If the ratio stays low, check whether shared_buffers (and effective_cache_size for planner costing) are sized to the machine's RAM.
- If the node reads far more pages than the rows it returns, add a selective index so only matching pages are fetched.

_Inspect current buffer-cache sizing:_
```sql
SHOW shared_buffers; SHOW effective_cache_size;
```

_Reduce pages read with a selective index:_
```sql
CREATE INDEX ON <table> (<predicate columns>);
```

📖 [PostgreSQL docs](https://www.postgresql.org/docs/current/runtime-config-resource.html#GUC-SHARED-BUFFERS)

### 🔵 Note — Low cache hit ratio at Seq Scan on orders (2.3%)

`PGX_LOW_CACHE_HIT`

**What:** Seq Scan on orders served only 2.3% of its shared-buffer accesses from cache, reading 5,000 blk (39.1 MiB) from disk.

**Why:** The pages this node needed were not resident in shared_buffers, so PostgreSQL had to read them from disk. On a first run this is an expected cold cache; if it persists, the working set is larger than the cache or the scan touches more pages than necessary.

**Fix:** Re-run the query to check whether this is just a cold cache — the ratio should climb on a warm run. If it stays low, the working set exceeds shared_buffers: size shared_buffers/effective_cache_size to your RAM, or add a selective index on orders so far fewer pages are read.

- Run the same EXPLAIN (ANALYZE, BUFFERS) a second time; a much higher hit ratio means the first run was a cold cache and no action is needed.
- If the ratio stays low, check whether shared_buffers (and effective_cache_size for planner costing) are sized to the machine's RAM.
- If the node reads far more pages than the rows it returns, add a selective index so only matching pages are fetched.

_Inspect current buffer-cache sizing:_
```sql
SHOW shared_buffers; SHOW effective_cache_size;
```

_Reduce pages read with a selective index:_
```sql
CREATE INDEX ON orders (<predicate columns>);
```

📖 [PostgreSQL docs](https://www.postgresql.org/docs/current/runtime-config-resource.html#GUC-SHARED-BUFFERS)
