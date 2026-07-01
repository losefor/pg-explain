import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding, outerChild } from "./util.ts";

/**
 * A Limit node whose input produced far more rows than it emitted — the classic
 * `LIMIT n OFFSET m` pagination pattern. Postgres must generate and throw away the
 * whole skipped prefix, so page N costs O(N). Keyset pagination stays O(1).
 */
export const limitLargeOffset: Rule = {
  id: "PGX_LIMIT_LARGE_OFFSET",
  title: "LIMIT discards a large prefix (OFFSET pagination)",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Limit") return [];

    const child = outerChild(node);
    const emitted = node.metrics.totalRows;
    const produced = child?.metrics.totalRows;
    if (emitted === undefined || produced === undefined) return [];

    const discarded = produced - emitted;
    if (discarded < ctx.thresholds.limitDiscardRows) return [];

    const rel = child?.relationName ?? "the input";

    return [
      makeFinding(limitLargeOffset, ctx, node, {
        title: `LIMIT discarded ${fmtInt(discarded)} rows before returning ${fmtInt(emitted)}`,
        detail: `The plan produced ${fmtInt(produced)} rows from ${rel} but the Limit node returned only ${fmtInt(emitted)} — ${fmtInt(discarded)} rows were generated just to be skipped.`,
        cause:
          "OFFSET-style pagination makes Postgres compute and discard every row before the requested page, so deep pages get progressively slower (page N costs O(N)).",
        remediation: {
          summary:
            "Switch to keyset (seek) pagination: filter on the last-seen sort key instead of skipping rows, and keep an index on the sort key so each page is a direct index seek.",
          steps: [
            "Order by a unique (or tie-broken) key, e.g. ORDER BY created_at, id.",
            "Pass the last row's key from the previous page instead of an OFFSET.",
            "Index the sort key so the WHERE clause seeks directly to the page start.",
          ],
          commands: [
            {
              label: "Keyset pagination instead of OFFSET",
              sql: "SELECT … FROM t WHERE (created_at, id) > ($last_created_at, $last_id) ORDER BY created_at, id LIMIT 50;",
            },
          ],
        },
        docsUrl: `${DOCS}/queries-limit.html`,
        meta: { discarded: Math.round(discarded), emitted: Math.round(emitted) },
      }),
    ];
  },
};
