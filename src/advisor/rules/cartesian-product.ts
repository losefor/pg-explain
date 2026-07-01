import type { PlanNode, Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/** Measured rows if available, else the planner estimate. */
function rowsOf(node: PlanNode): number {
  return node.metrics.totalRows ?? node.planRows;
}

/**
 * Nested Loop with no join predicate anywhere — neither a Join Filter on the loop
 * nor an Index Cond / Recheck Cond on the inner side. Every outer row is paired with
 * every inner row, so the result is the cross product (rows ≈ outer × inner). This is
 * almost always a forgotten ON / WHERE join condition; precision is kept high by
 * requiring both sides to actually produce rows.
 */
export const cartesianProduct: Rule = {
  id: "PGX_CARTESIAN_PRODUCT",
  title: "Cartesian product (missing join condition)",
  defaultSeverity: "error",
  check(node, ctx) {
    if (node.nodeType !== "Nested Loop") return [];
    if (node.joinFilter) return [];

    let inner = node.children[1];
    if (!inner) return [];
    // Memoize/Materialize wrap the real inner scan — the join predicate lives below them.
    while (
      (inner.nodeType === "Memoize" || inner.nodeType === "Materialize") &&
      inner.children[0]
    ) {
      inner = inner.children[0];
    }
    // A join key on the inner side (index lookup) means there IS a predicate.
    if (inner.indexCond || inner.recheckCond) return [];

    const outer = node.children[0];
    if (!outer) return [];

    const outerRows = rowsOf(outer);
    const innerRows = rowsOf(inner);
    // Single-row sides are legitimately matched against everything (e.g. a LIMIT 1
    // or aggregate); a cross product is only meaningful when both sides are sets.
    if (outerRows <= 1 || innerRows <= 1) return [];

    const estimated = node.metrics.totalRows === undefined;
    const product = fmtInt(outerRows * innerRows);

    return [
      makeFinding(cartesianProduct, ctx, node, {
        title: `Cartesian product: Nested Loop with no join condition (~${product}${estimated ? " est." : ""} rows)`,
        detail: `The Nested Loop has no Join Filter and the inner side has no Index Cond or Recheck Cond, so each of ${fmtInt(
          outerRows,
        )} outer rows is paired with every one of ${fmtInt(innerRows)} inner rows${
          estimated ? " (estimated — run with ANALYZE for actuals)" : ""
        }.`,
        cause:
          "No predicate links the two relations, so Postgres can only emit the full cross product. This usually means an ON or WHERE join condition was omitted (e.g. a comma join across tables).",
        remediation: {
          summary:
            "Add the missing join condition linking the two tables on their key columns (e.g. ON a.id = b.a_id). If a cross product is truly intended, make it explicit with CROSS JOIN and bound it with a LIMIT or aggregation.",
          steps: [
            "Find the two relations feeding this Nested Loop in your query.",
            "Add an ON (or WHERE) clause matching their key columns so the loop becomes selective.",
            "If you really want every combination, write CROSS JOIN explicitly and cap the size with LIMIT or an aggregate.",
          ],
          commands: [
            {
              label: "Add the join predicate",
              sql: "SELECT ...\nFROM <outer_table> a\nJOIN <inner_table> b ON a.<key> = b.<key>;",
            },
            {
              label: "Or make the cross join explicit and bounded",
              sql: "SELECT ...\nFROM <outer_table> a\nCROSS JOIN <inner_table> b\nLIMIT <n>;",
            },
          ],
        },
        docsUrl: `${DOCS}/queries-table-expressions.html#QUERIES-JOIN`,
        meta: { outerRows: Math.round(outerRows), innerRows: Math.round(innerRows) },
      }),
    ];
  },
};
