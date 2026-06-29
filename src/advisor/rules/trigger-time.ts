import { executionMs } from "../../core/metrics.ts";
import type { Rule } from "../../core/model.ts";
import { fmtMs, fmtPct } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * Triggers consume a significant fraction of execution time. Trigger work (FK
 * constraint checks, AFTER triggers, etc.) runs outside the plan tree, so it is
 * invisible in the node timings and easy to miss. We surface it when the summed
 * trigger time crosses `triggerPct` of total execution time.
 */
export const triggerTime: Rule = {
  id: "PGX_TRIGGER_TIME",
  title: "Triggers consume significant time",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    // Tree-level rule — act only at the root.
    if (node !== ctx.tree.root) return [];

    const triggers = ctx.tree.triggers;
    const execMs = executionMs(ctx.tree);
    const triggerTotal = triggers.reduce((s, t) => s + (t.time ?? 0), 0);
    if (!triggers.length || !execMs || triggerTotal <= 0) return [];

    const pct = (100 * triggerTotal) / execMs;
    if (pct <= ctx.thresholds.triggerPct) return [];

    // Name the heaviest trigger so the message is concrete.
    const worst = triggers.reduce((a, b) => ((b.time ?? 0) > (a.time ?? 0) ? b : a));
    const worstLabel = worst.name ?? worst.constraintName ?? "a trigger";
    const onRel = worst.relation ? ` on ${worst.relation}` : "";

    return [
      makeFinding(triggerTime, ctx, node, {
        title: `Triggers consumed ${fmtMs(triggerTotal)} (${fmtPct(pct)} of execution)`,
        detail: `Trigger execution took ${fmtMs(triggerTotal)} of the ${fmtMs(
          execMs,
        )} total — ${fmtPct(pct)} of the time is spent outside the plan tree (heaviest: "${worstLabel}"${onRel}).`,
        cause:
          "Time spent firing triggers (often foreign-key constraint checks or AFTER triggers) is not attributed to any plan node, so it is invisible in the node timings even though it dominates the statement.",
        remediation: {
          summary: `Index the foreign-key columns involved in the constraint checks so each row's lookup is cheap, and review the trigger function bodies for per-row inefficiency. For bulk loads, defer constraints (SET CONSTRAINTS ALL DEFERRED) or disable and replay triggers around the batch.`,
          steps: [
            "Confirm both the referencing and referenced FK columns are indexed — an FK check does a lookup on the referenced key for every row, and a missing index makes it a full scan per row.",
            "Inspect each trigger function body for per-row work that could be batched or removed.",
            "For bulk INSERT/UPDATE/COPY, defer FK constraints until commit, or temporarily disable user triggers and replay the work once after the batch.",
          ],
          commands: [
            {
              label: "Index the referencing FK column(s) so constraint checks are cheap",
              sql: `CREATE INDEX ON <referencing_table> (<fk_columns>);`,
            },
            {
              label: "Defer FK constraint checks to commit for a bulk load",
              sql: `BEGIN;\nSET CONSTRAINTS ALL DEFERRED;\n-- bulk INSERT/UPDATE/COPY here\nCOMMIT;`,
            },
            {
              label: "Disable user triggers around a batch, then re-enable",
              sql: `ALTER TABLE <table> DISABLE TRIGGER USER;\n-- bulk work here\nALTER TABLE <table> ENABLE TRIGGER USER;`,
            },
          ],
        },
        docsUrl: `${DOCS}/sql-createtrigger.html`,
        meta: { triggerMs: Math.round(triggerTotal), triggerPct: Math.round(pct) },
      }),
    ];
  },
};
