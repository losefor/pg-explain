import type { Rule } from "../../core/model.ts";
import { fmtInt, fmtPct } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A node reads many rows then throws most of them away via a post-read Filter. The
 * discarded rows were still fetched and examined, so the work is wasted. Pushing the
 * predicate into an index turns the Filter into an Index Cond, letting Postgres skip
 * the non-matching rows entirely instead of reading and rejecting them.
 */
export const highFilterDiscard: Rule = {
  id: "PGX_HIGH_FILTER_DISCARD",
  title: "Filter discards most rows read",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    const ratio = node.metrics.filterDiscardRatio;
    if (ratio === undefined || ratio <= ctx.thresholds.filterDiscardRatio) return [];

    const removed = (node.rowsRemovedByFilter ?? 0) * (node.actualLoops ?? 1);
    if (removed <= ctx.thresholds.filterRemovedAbs) return [];

    const rel = node.relationName ?? "the table";
    const kept = node.metrics.totalRows ?? 0;
    const discardPct = ratio * 100;
    const filter = node.filter ?? "the filter predicate";

    return [
      makeFinding(highFilterDiscard, ctx, node, {
        title: `Filter on ${rel} discards ${fmtPct(discardPct)} of rows read`,
        detail: `Postgres read this node's rows then dropped ${fmtInt(removed)} of them (${fmtPct(
          discardPct,
        )}), keeping only ${fmtInt(kept)}, via the post-read filter ${filter}.`,
        cause: `The predicate ${filter} is evaluated as a Filter after the rows are fetched, so every discarded row was still read and examined — work no index condition narrowed.`,
        remediation: {
          summary: `Move ${filter} into an index on ${rel} so the predicate becomes an Index Cond instead of a post-read Filter, letting Postgres skip the non-matching rows. For a low-cardinality predicate, a partial index keyed on the discarded condition is smaller and faster.`,
          steps: [
            "Identify the column(s) referenced by the filter above.",
            "Ensure the predicate is sargable (no function-wrapping or implicit casts on the indexed column).",
            "Use a plain index when the columns are selective across queries; use a partial index when the same constant predicate is always applied.",
          ],
          commands: [
            {
              label: "Index the filter columns",
              sql: `CREATE INDEX ON ${rel} (<filter columns>);`,
            },
            {
              label: "Or a partial index for a fixed low-cardinality predicate",
              sql: `CREATE INDEX ON ${rel} (<filter columns>) WHERE <predicate>;`,
            },
          ],
        },
        docsUrl: `${DOCS}/indexes-partial.html`,
        meta: { discardPct: Math.round(discardPct) },
      }),
    ];
  },
};
