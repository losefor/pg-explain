import type { Rule } from "../../core/model.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * Hint: an Index Scan that projects only a few columns and applies no residual
 * filter (the whole predicate lives in the Index Cond) MIGHT qualify for an
 * Index Only Scan if the index covers every selected column. We cannot see the
 * index definition from EXPLAIN, so this is low-confidence — phrased as a
 * suggestion and kept at `info`. Requires VERBOSE for the Output column list.
 */
export const couldBeIndexOnly: Rule = {
  id: "PGX_COULD_BE_INDEX_ONLY",
  title: "Index scan may be eligible for index-only",
  defaultSeverity: "info",
  check(node, ctx) {
    if (node.nodeType !== "Index Scan") return [];
    if (!node.indexName) return [];
    // A residual Filter means columns beyond the index are needed for the
    // predicate, so it cannot become index-only — skip those.
    if (node.filter) return [];
    // Need VERBOSE output to know which columns are projected.
    if (!node.output || node.output.length === 0) return [];
    // Only hint for a small, plausibly-coverable column set.
    if (node.output.length > 4) return [];

    const rel = node.relationName ?? "the table";
    const cols = node.output;
    const colList = cols.join(", ");
    const includeCols = cols.join(", ");

    return [
      makeFinding(couldBeIndexOnly, ctx, node, {
        title: `Index Scan using ${node.indexName} on ${rel} may be eligible for index-only`,
        detail: `This Index Scan projects only ${cols.length} column${
          cols.length === 1 ? "" : "s"
        } (${colList}) and applies no residual filter, so its predicate is fully resolved by ${node.indexName}. If that index also covers the selected columns, Postgres could use an Index Only Scan and skip the heap entirely.`,
        cause:
          "An Index Scan still visits the table heap to fetch the projected columns. When every selected column is contained in the index (as a key or INCLUDE column) and the visibility map is current, Postgres can answer from the index alone (Index Only Scan).",
        remediation: {
          summary: `Add the selected columns (${includeCols}) to ${node.indexName} as INCLUDE columns so it covers the query, then keep the visibility map current with VACUUM so Postgres can switch ${rel} to an Index Only Scan.`,
          steps: [
            "Confirm which columns the index already covers (\\d <index> in psql) — this hint assumes VERBOSE Output and cannot read the index definition.",
            "If any projected column is missing, recreate the index with those columns as INCLUDE (non-key) columns.",
            "Run VACUUM so the visibility map is set; Index Only Scans fall back to heap fetches on pages not marked all-visible.",
          ],
          commands: [
            {
              label: "Create a covering index",
              sql: `CREATE INDEX ON ${rel} (<key columns from the Index Cond>) INCLUDE (${includeCols});`,
            },
            {
              label: "Keep the visibility map current",
              sql: `VACUUM ${rel};`,
            },
          ],
        },
        docsUrl: `${DOCS}/indexes-index-only-scans.html`,
        meta: { outputColumns: cols.length },
      }),
    ];
  },
};
