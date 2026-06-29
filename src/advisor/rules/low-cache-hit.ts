import { nodeLabel } from "../../core/metrics.ts";
import type { Rule } from "../../core/model.ts";
import { fmtBlocks, fmtPct } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/** Below this many disk-read blocks the cold-cache noise outweighs any real signal. */
const MIN_READ_BLOCKS = 1000;

/**
 * Low shared-buffer cache hit ratio: the node fetched many pages from disk rather
 * than from PostgreSQL's buffer cache. This is often just a cold cache on the first
 * run, so the finding is informational and leads with "re-run to confirm" before
 * suggesting shared_buffers sizing or a more selective index.
 */
export const lowCacheHit: Rule = {
  id: "PGX_LOW_CACHE_HIT",
  title: "Low cache hit ratio (heavy disk reads)",
  defaultSeverity: "info",
  requiresBuffers: true,
  check(node, ctx) {
    const ratio = node.metrics.cacheHitRatio;
    const readBlocks = node.sharedReadBlocks ?? 0;
    if (ratio == null) return [];
    if (ratio >= ctx.thresholds.lowCacheHitRatio) return [];
    if (readBlocks <= MIN_READ_BLOCKS) return [];

    const label = nodeLabel(node);
    const rel = node.relationName;
    const ratioPct = ratio * 100;

    return [
      makeFinding(lowCacheHit, ctx, node, {
        title: `Low cache hit ratio at ${label} (${fmtPct(ratioPct)})`,
        detail: `${label} served only ${fmtPct(ratioPct)} of its shared-buffer accesses from cache, reading ${fmtBlocks(readBlocks)} from disk.`,
        cause:
          "The pages this node needed were not resident in shared_buffers, so PostgreSQL had to read them from disk. On a first run this is an expected cold cache; if it persists, the working set is larger than the cache or the scan touches more pages than necessary.",
        remediation: {
          summary: `Re-run the query to check whether this is just a cold cache — the ratio should climb on a warm run. If it stays low, the working set exceeds shared_buffers: size shared_buffers/effective_cache_size to your RAM, or add a selective index on ${rel ?? "the scanned relation"} so far fewer pages are read.`,
          steps: [
            "Run the same EXPLAIN (ANALYZE, BUFFERS) a second time; a much higher hit ratio means the first run was a cold cache and no action is needed.",
            "If the ratio stays low, check whether shared_buffers (and effective_cache_size for planner costing) are sized to the machine's RAM.",
            "If the node reads far more pages than the rows it returns, add a selective index so only matching pages are fetched.",
          ],
          commands: [
            {
              label: "Inspect current buffer-cache sizing",
              sql: "SHOW shared_buffers; SHOW effective_cache_size;",
            },
            {
              label: "Reduce pages read with a selective index",
              sql: `CREATE INDEX ON ${rel ?? "<table>"} (<predicate columns>);`,
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html#GUC-SHARED-BUFFERS`,
        meta: { cacheHitPct: Math.round(ratioPct * 10) / 10, readBlocks },
      }),
    ];
  },
};
