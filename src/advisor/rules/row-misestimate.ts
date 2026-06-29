import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * The planner's row estimate is wildly off from the actual row count. Bad estimates
 * cascade into bad join/sort/memory choices, so a large factor — especially an
 * underestimate feeding a nested loop or hash — is a leading cause of slow plans.
 * Usually it means statistics are stale or too coarse for the predicate.
 */
export const rowMisestimate: Rule = {
  id: "PGX_ROW_MISESTIMATE",
  title: "Row count misestimate",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    const { estimateFactor, estimateDirection, totalRows } = node.metrics;
    if (estimateFactor === undefined) return [];
    if (estimateFactor < ctx.thresholds.misestimateFactor) return [];
    if (estimateDirection === undefined || estimateDirection === "accurate") return [];

    // Cut noise: a 20× error on 3 rows is irrelevant; only care at real volume.
    const rows = Math.max(totalRows ?? 0, node.planRows);
    if (rows < 100) return [];

    const factor = Math.round(estimateFactor);
    const rel = node.relationName;
    const onRel = rel ? ` on ${rel}` : "";
    const target = rel ?? "the underlying table";
    const under = estimateDirection === "under";
    const direction = under ? "underestimate" : "overestimate";

    const actual = totalRows ?? 0;
    const detail = `Postgres estimated ${fmtInt(node.planRows)} rows but ${fmtInt(actual)} were produced — a ${fmtInt(factor)}x ${direction}${onRel}.`;

    return [
      makeFinding(rowMisestimate, ctx, node, {
        // Severity: underestimates are the dangerous ones (under-sized joins/memory).
        severity: under ? "warn" : "info",
        title: `${fmtInt(factor)}x row ${direction}${onRel}`,
        detail,
        cause:
          "The planner's row estimate is based on statistics that are stale, missing, or too coarse for this predicate (e.g. correlated columns the planner treats as independent).",
        remediation: {
          summary: `Refresh and sharpen statistics for ${target}: run ANALYZE ${rel ?? "<relation>"}, raise per-column statistics targets on the predicate columns, and add extended statistics for correlated columns so the planner estimates rows correctly.${
            under
              ? " Underestimates feeding a nested loop or hash join are the highest priority — fix these first."
              : ""
          }`,
          steps: [
            `Refresh table statistics first; this alone often fixes the estimate.`,
            `If the column has a skewed/uneven distribution, raise its statistics target and re-ANALYZE.`,
            `If the predicate spans multiple correlated columns, create extended statistics so the planner stops assuming independence.`,
          ],
          commands: [
            {
              label: "Refresh statistics",
              sql: `ANALYZE ${rel ?? "<relation>"};`,
            },
            {
              label: "Raise per-column statistics target",
              sql: `ALTER TABLE ${rel ?? "<relation>"} ALTER COLUMN <column> SET STATISTICS 1000;\nANALYZE ${rel ?? "<relation>"};`,
            },
            {
              label: "Add extended statistics for correlated columns",
              sql: `CREATE STATISTICS <stats_name> (dependencies, ndistinct) ON <col_a>, <col_b> FROM ${rel ?? "<relation>"};\nANALYZE ${rel ?? "<relation>"};`,
            },
          ],
        },
        docsUrl: `${DOCS}/planner-stats.html`,
        meta: {
          estimatedRows: Math.round(node.planRows),
          actualRows: Math.round(actual),
          factor,
          direction: estimateDirection,
        },
      }),
    ];
  },
};
