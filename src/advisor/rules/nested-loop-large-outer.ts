import { nodeLabel } from "../../core/metrics.ts";
import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding, outerChild } from "./util.ts";

/**
 * Nested loop whose outer (driving) side produced many rows. A nested loop runs the
 * inner subtree once per outer row, so a large outer side multiplies the inner cost.
 * The planner usually picks this only when it expects few outer rows — so the root
 * cause is normally a cardinality misestimate. Fix the estimate first (so it switches
 * to a hash/merge join); if the estimate is right, index the inner join key.
 */
export const nestedLoopLargeOuter: Rule = {
  id: "PGX_NESTED_LOOP_LARGE_OUTER",
  title: "Nested loop with a large outer side",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Nested Loop") return [];

    const outer = outerChild(node);
    const outerRows = outer?.metrics.totalRows;
    if (outerRows === undefined || outerRows <= ctx.thresholds.nestedLoopOuterRows) return [];

    const outerLabel = outer ? nodeLabel(outer) : "the outer side";
    const inner = node.children[1];
    const innerLabel = inner ? nodeLabel(inner) : "the inner side";
    const innerCond = inner?.indexCond ?? inner?.joinFilter ?? inner?.filter ?? node.joinFilter;
    const misestimated = outer?.metrics.estimateDirection === "under";

    return [
      makeFinding(nestedLoopLargeOuter, ctx, node, {
        title: `Nested loop driven by ${fmtInt(outerRows)} outer rows (${outerLabel})`,
        detail: `The nested loop's outer side (${outerLabel}) produced ${fmtInt(
          outerRows,
        )} rows, so its inner side (${innerLabel}) is re-executed roughly that many times.`,
        cause: misestimated
          ? `The planner expected far fewer outer rows than the ${fmtInt(
              outerRows,
            )} that actually came back, so it chose a per-row nested loop where a single hash/merge join would have been cheaper.`
          : `A nested loop probes the inner side once per outer row; with ${fmtInt(
              outerRows,
            )} outer rows that is ${fmtInt(outerRows)} inner executions.`,
        remediation: {
          summary: `Fix the outer-side row estimate first — re-ANALYZE ${
            outer?.relationName ?? "the driving table"
          }, raise its column statistics, or add extended statistics — so the planner switches to a hash or merge join. If the estimate is already accurate, add an index on the inner join key (${
            innerCond ?? "<inner join column>"
          }) so each of the ${fmtInt(outerRows)} probes is cheap.`,
          steps: [
            "Compare the outer node's estimated vs actual rows: a large gap means the estimate is the real problem.",
            "Refresh statistics so the planner sees the true cardinality and can prefer a hash/merge join.",
            "If columns are correlated, create extended (multivariate) statistics on them.",
            "If estimates are already correct, index the inner join key so each probe is an index lookup, not a scan.",
            "As a last resort to confirm the diagnosis, test with `SET enable_nestloop = off` for this query only.",
          ],
          commands: [
            {
              label: "Refresh planner statistics on the driving table",
              sql: `ANALYZE ${outer?.relationName ?? "<outer table>"};`,
            },
            {
              label: "Increase statistics target on the misestimated column, then re-ANALYZE",
              sql: `ALTER TABLE ${
                outer?.relationName ?? "<outer table>"
              } ALTER COLUMN <column> SET STATISTICS 1000;\nANALYZE ${
                outer?.relationName ?? "<outer table>"
              };`,
            },
            {
              label: "Add extended statistics for correlated columns",
              sql: `CREATE STATISTICS ${
                outer?.relationName ?? "<outer table>"
              }_stats (dependencies, ndistinct) ON <col_a>, <col_b> FROM ${
                outer?.relationName ?? "<outer table>"
              };\nANALYZE ${outer?.relationName ?? "<outer table>"};`,
            },
            {
              label: "If estimates are correct, index the inner join key",
              sql: `CREATE INDEX ON ${
                inner?.relationName ?? "<inner table>"
              } (<inner join column>);`,
            },
            {
              label: "Confirm the diagnosis by disabling nested loops for this query only",
              sql: "SET enable_nestloop = off;",
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-query.html`,
        meta: { outerRows: Math.round(outerRows) },
      }),
    ];
  },
};
