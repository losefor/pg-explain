import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * Bitmap heap scan whose bitmap exceeded work_mem and degraded to page granularity.
 * When the per-tuple bitmap won't fit, Postgres stores only the heap *page* numbers
 * ("lossy" blocks) and re-checks the index condition against every tuple on those
 * pages, reading more heap and re-evaluating the predicate. Raising work_mem keeps the
 * bitmap exact; a more selective index also shrinks it.
 */
export const bitmapLossy: Rule = {
  id: "PGX_BITMAP_LOSSY",
  title: "Lossy bitmap heap scan",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Bitmap Heap Scan") return [];

    const lossy = node.lossyHeapBlocks ?? 0;
    if (lossy <= 0) return [];

    const exact = node.exactHeapBlocks ?? 0;
    const rel = node.relationName ?? "the table";
    const rechecked = node.rowsRemovedByIndexRecheck ?? 0;
    const recheckNote =
      rechecked > 0
        ? ` The recheck discarded ${fmtInt(rechecked)} extra rows that the lossy bitmap could not exclude.`
        : "";

    return [
      makeFinding(bitmapLossy, ctx, node, {
        title: `Lossy bitmap heap scan on ${rel} (${fmtInt(lossy)} lossy blocks)`,
        detail: `The bitmap for ${rel} held ${fmtInt(lossy)} lossy (page-granularity) blocks alongside ${fmtInt(
          exact,
        )} exact blocks, so Postgres re-checked the index condition against every tuple on the lossy pages.${recheckNote}`,
        cause:
          "The exact (per-tuple) bitmap did not fit in work_mem, so Postgres fell back to storing whole heap pages and recheck the index condition while reading them — more heap I/O and CPU than an exact bitmap.",
        remediation: {
          summary: `Raise work_mem for this session so the bitmap stays exact (no lossy blocks, no rechecks) on ${rel}; alternatively make the index condition more selective or add a composite index so the bitmap is smaller.`,
          steps: [
            "Increase work_mem for the session, then re-run EXPLAIN (ANALYZE) and confirm Lossy Heap Blocks drops to 0.",
            "If raising work_mem is undesirable, make the index condition more selective (a more selective leading column or a composite index over the filtered columns) so fewer heap pages enter the bitmap.",
          ],
          commands: [
            {
              label: "Give this session more work_mem",
              sql: "SET work_mem = '<X>MB';",
            },
            {
              label: "Or shrink the bitmap with a more selective index",
              sql: `CREATE INDEX ON ${rel} (<more selective / composite columns>);`,
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html#GUC-WORK-MEM`,
        meta: { lossyBlocks: lossy, exactBlocks: exact },
      }),
    ];
  },
};
