import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * Sequential scan reading a large relation. Often an index would let Postgres skip
 * most of the table. If the scan genuinely needs most rows it is correct, so the fix
 * is phrased around the predicate.
 */
export const seqScanLarge: Rule = {
  id: "PGX_SEQ_SCAN_LARGE",
  title: "Sequential scan on a large table",
  defaultSeverity: "warn",
  check(node, ctx) {
    if (node.nodeType !== "Seq Scan") return [];

    // Prefer measured rows; fall back to the estimate on cost-only plans.
    const rows = node.metrics.totalRows ?? node.planRows;
    if (rows < ctx.thresholds.seqScanRows) return [];

    const rel = node.relationName ?? "the table";
    const estimated = node.metrics.totalRows === undefined;
    const filterCols = node.filter ? ` matching ${node.filter}` : "";

    return [
      makeFinding(seqScanLarge, ctx, node, {
        title: `Sequential scan on ${rel} (${fmtInt(rows)}${estimated ? " est." : ""} rows)`,
        detail: `Postgres read ${rel} sequentially, scanning roughly ${fmtInt(rows)} rows${
          estimated ? " (estimated — run with ANALYZE for actuals)" : ""
        }.`,
        cause: node.filter
          ? `A row filter (${node.filter}) is applied after reading every row, so no index narrowed the scan.`
          : "No index condition narrowed the scan, so the whole relation was read.",
        remediation: {
          summary: `Add an index covering the WHERE/JOIN predicate on ${rel} so Postgres can skip non-matching rows. If the query genuinely needs most of the table, the seq scan is correct — reduce the rows touched instead.`,
          steps: [
            "Identify the selective columns in the WHERE/JOIN predicate.",
            "Ensure they are sargable (no function-wrapping or implicit casts on the column).",
            "If selectivity is low, a partial index (WHERE …) may be better.",
          ],
          commands: [
            {
              label: "Index the predicate columns",
              sql: `CREATE INDEX ON ${rel} (<predicate columns>)${filterCols ? " -- columns from the filter above" : ""};`,
            },
          ],
        },
        docsUrl: `${DOCS}/indexes-intro.html`,
        meta: { rows: Math.round(rows) },
      }),
    ];
  },
};
