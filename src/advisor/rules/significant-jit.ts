import { executionMs } from "../../core/metrics.ts";
import type { Rule } from "../../core/model.ts";
import { fmtMs, fmtPct } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * JIT compilation time dominates total execution. Common on short queries whose plan
 * cost crossed `jit_above_cost`: the one-off cost of generating/optimizing machine code
 * outweighs the runtime it saves, so the query would have been faster with JIT off.
 * Tree-level rule — only acts at the root.
 */
export const significantJit: Rule = {
  id: "PGX_SIGNIFICANT_JIT",
  title: "JIT compilation dominates execution",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node !== ctx.tree.root) return [];

    const t = ctx.tree.jit?.timing;
    const jitTotal =
      t?.total ??
      (t?.generation ?? 0) + (t?.inlining ?? 0) + (t?.optimization ?? 0) + (t?.emission ?? 0);
    const execMs = executionMs(ctx.tree);
    if (!execMs || jitTotal <= 0) return [];

    const jitPct = (100 * jitTotal) / execMs;
    if (jitPct <= ctx.thresholds.jitPct) return [];

    return [
      makeFinding(significantJit, ctx, node, {
        title: `JIT compilation took ${fmtMs(jitTotal)} (${fmtPct(jitPct)} of execution)`,
        detail: `JIT spent ${fmtMs(jitTotal)} generating, optimizing, and emitting machine code, out of ${fmtMs(
          execMs,
        )} total execution time. The compilation overhead outweighs the runtime it saved.`,
        cause:
          "The plan's estimated cost crossed jit_above_cost, so Postgres JIT-compiled the query — but the query is too short for compilation to pay off, often because a row overestimate inflated the cost.",
        remediation: {
          summary:
            "Raise jit_above_cost (and jit_inline_above_cost / jit_optimize_above_cost) so short queries skip JIT, or disable JIT for this session with SET jit = off. Then investigate why the cost estimate is high enough to trigger JIT — frequently a row overestimate fixable with ANALYZE.",
          steps: [
            "Confirm the query is consistently short-running before tuning — JIT pays off on long, CPU-bound queries.",
            "Raise jit_above_cost above this plan's total cost so similar queries skip JIT entirely.",
            "If only inlining/optimization are expensive, raise jit_inline_above_cost / jit_optimize_above_cost instead of disabling JIT.",
            "Check the planner's row estimates against actuals — an overestimate that inflates cost is the usual reason a cheap query triggers JIT; run ANALYZE on the relations involved.",
          ],
          commands: [
            { label: "Disable JIT for this session", sql: "SET jit = off;" },
            {
              label: "Raise the JIT cost thresholds",
              sql: "SET jit_above_cost = <above this plan's total cost>;\nSET jit_inline_above_cost = <higher>;\nSET jit_optimize_above_cost = <higher>;",
            },
            {
              label: "Refresh statistics if the cost is driven by a row overestimate",
              sql: "ANALYZE <table>;",
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-query.html#GUC-JIT-ABOVE-COST`,
        meta: { jitMs: Math.round(jitTotal), jitPct: Math.round(jitPct) },
      }),
    ];
  },
};
