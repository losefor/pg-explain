import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * Index-only scan that still hit the heap. Each heap fetch means the visibility map
 * marked that page as not all-visible, so Postgres had to read the table row to check
 * visibility — defeating the index-only optimization. The usual cause is a table that
 * has not been vacuumed recently enough relative to its write rate.
 */
export const indexOnlyHeapFetches: Rule = {
  id: "PGX_INDEX_ONLY_HEAP_FETCHES",
  title: "Index-only scan with heap fetches",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Index Only Scan") return [];

    const heapFetches = node.heapFetches ?? 0;
    if (heapFetches <= 0) return [];

    const rows = Math.max(node.metrics.totalRows ?? 1, 1);
    const ratio = heapFetches / rows;
    if (ratio <= ctx.thresholds.heapFetchRatio && heapFetches <= ctx.thresholds.heapFetchAbs) {
      return [];
    }

    const rel = node.relationName ?? "the table";

    return [
      makeFinding(indexOnlyHeapFetches, ctx, node, {
        title: `Index-only scan on ${rel} did ${fmtInt(heapFetches)} heap fetches`,
        detail: `The index-only scan on ${rel} fell back to the heap ${fmtInt(heapFetches)} times for ${fmtInt(
          rows,
        )} rows produced. Each fetch is an extra table page read the index-only path was meant to avoid.`,
        cause: `Heap fetches happen when the visibility map does not mark the pages as all-visible, so Postgres must read the table row to confirm visibility. This usually means ${rel} has not been vacuumed recently enough for its write/update rate.`,
        remediation: {
          summary: `Run VACUUM (or VACUUM ANALYZE) on ${rel} to refresh the visibility map so the index-only scan can skip the heap. For a high-churn table, lower autovacuum_vacuum_scale_factor so autovacuum keeps the map current.`,
          steps: [
            `VACUUM ${rel} to update the visibility map; add ANALYZE if statistics are also stale.`,
            "If heap fetches keep returning, the table is updated faster than autovacuum runs — make autovacuum more aggressive on it.",
            "Confirm the scan stays index-only afterwards by re-running EXPLAIN (ANALYZE) and checking Heap Fetches drops toward 0.",
          ],
          commands: [
            {
              label: "Refresh the visibility map",
              sql: `VACUUM (ANALYZE) ${rel};`,
            },
            {
              label: "Keep the map current on a high-churn table",
              sql: `ALTER TABLE ${rel} SET (autovacuum_vacuum_scale_factor = 0.02);`,
            },
          ],
        },
        docsUrl: `${DOCS}/indexes-index-only-scans.html`,
        meta: { heapFetches },
      }),
    ];
  },
};
