import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * An index/bitmap scan that still applies a residual Filter after the index lookup.
 * The Filter is evaluated on every heap row the index returned; folding those columns
 * into the index lets Postgres apply them as an Index Cond during traversal, skipping
 * the rows entirely. This is a hint (severity info): a non-sargable predicate cannot be
 * indexed, so the fix is phrased around making the filter index-friendly.
 */
export const filterCouldBeIndexCond: Rule = {
  id: "PGX_FILTER_COULD_BE_INDEX_COND",
  title: "Filter could be an index condition",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    const indexed =
      node.nodeType === "Index Scan" ||
      node.nodeType === "Index Only Scan" ||
      node.nodeType === "Bitmap Heap Scan";
    if (!indexed) return [];
    if (!node.filter) return [];
    if (!node.indexCond && !node.recheckCond) return [];
    if ((node.rowsRemovedByFilter ?? 0) <= 0) return [];

    const rel = node.relationName ?? "the table";
    const cond = node.indexCond ?? node.recheckCond ?? "";
    const loops = node.actualLoops ?? 1;
    const removed = (node.rowsRemovedByFilter ?? 0) * loops;

    return [
      makeFinding(filterCouldBeIndexCond, ctx, node, {
        title: `Residual filter on ${rel} could be an index condition`,
        detail: `${node.nodeType} on ${rel} used the index for ${cond} but then applied Filter ${node.filter} to the fetched rows, discarding ${fmtInt(removed)} of them.`,
        cause: `The Filter columns are not part of the index, so Postgres must fetch each row the index matched and re-check the predicate in the executor instead of skipping non-matching entries during the index traversal.`,
        remediation: {
          summary: `Extend the index on ${rel} to include the Filter columns from ${node.filter} as trailing key columns, so the predicate is applied as an Index Cond during traversal instead of as a post-fetch Filter.`,
          steps: [
            `Confirm the Filter ${node.filter} is sargable — no functions or implicit casts wrapping the column.`,
            "Append the filter columns after the existing key columns so the index still serves the original lookup.",
            "Re-run EXPLAIN (ANALYZE) and check the Filter moved into the Index Cond with no Rows Removed by Filter.",
          ],
          commands: [
            {
              label: "Extend the index with the filter columns",
              sql: `CREATE INDEX ON ${rel} (<existing key columns>, <filter columns>);`,
            },
          ],
        },
        docsUrl: `${DOCS}/indexes-multicolumn.html`,
        meta: { rowsRemovedByFilter: Math.round(removed) },
      }),
    ];
  },
};
