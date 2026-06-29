import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A correlated subquery surfaces as a SubPlan node whose `actualLoops` equals the
 * number of outer rows: the planner re-executes it once per row instead of running
 * it once. Above the loop threshold this dominates execution time. The fix is to
 * de-correlate it — rewrite as a JOIN/LATERAL or hoist into a CTE evaluated once.
 */
export const correlatedSubplan: Rule = {
  id: "PGX_CORRELATED_SUBPLAN",
  title: "Correlated subplan re-executed per row",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    const isSubplan =
      node.parentRelationship === "SubPlan" || (node.subplanName?.startsWith("SubPlan") ?? false);
    if (!isSubplan) return [];

    const loops = node.actualLoops ?? 0;
    if (loops <= ctx.thresholds.correlatedLoops) return [];

    const name = node.subplanName ?? "the subplan";

    return [
      makeFinding(correlatedSubplan, ctx, node, {
        title: `Correlated ${name} re-executed ${fmtInt(loops)} times`,
        detail: `${name} ran ${fmtInt(loops)} times — once per outer row — instead of being evaluated a single time.`,
        cause:
          "The subquery references a column from the enclosing query, so the planner cannot pull it out of the per-row loop and re-runs the whole subplan for every outer row.",
        remediation: {
          summary: `De-correlate the subquery: rewrite it as a JOIN or LATERAL join, or hoist it into a CTE/derived table evaluated once, then index the correlation key so the rewrite stays cheap.`,
          steps: [
            "Identify the outer column the subquery references (the correlation key).",
            "For a scalar subquery in SELECT/WHERE, rewrite it as a LEFT JOIN to a grouped derived table, or a LATERAL join when it returns per-row results.",
            "For EXISTS/IN, prefer the semi-join form (EXISTS / = ANY) the planner can de-correlate into a single hash/merge join.",
            "Add an index on the correlation key so the resulting JOIN does not fall back to the same per-row cost.",
            // Before (correlated, runs once per outer row):
            //   SELECT o.id, (SELECT count(*) FROM events e WHERE e.order_id = o.id) AS n FROM orders o;
            // After (evaluated once, joined):
            //   SELECT o.id, COALESCE(e.n, 0) AS n
            //   FROM orders o
            //   LEFT JOIN (SELECT order_id, count(*) AS n FROM events GROUP BY order_id) e
            //     ON e.order_id = o.id;
            "See the before/after sketch: SELECT (SELECT count(*) FROM events e WHERE e.order_id = o.id) becomes a LEFT JOIN to (SELECT order_id, count(*) FROM events GROUP BY order_id).",
          ],
          commands: [
            {
              label: "Index the correlation key so the de-correlated JOIN stays cheap",
              sql: "CREATE INDEX ON <subquery table> (<correlation key column>);",
            },
          ],
        },
        docsUrl: `${DOCS}/queries-table-expressions.html#QUERIES-LATERAL`,
        meta: { loops },
      }),
    ];
  },
};
