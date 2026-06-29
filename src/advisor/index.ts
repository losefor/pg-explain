import { DEFAULT_CONFIG, type PgExplainConfig } from "../config.ts";
import { bottlenecks, executionMs, nodeLabel } from "../core/metrics.ts";
import type {
  AnalysisContext,
  AnalysisResult,
  Diagnostic,
  PlanTree,
  Severity,
} from "../core/model.ts";
import { flatten } from "../core/parse.ts";
import { bySeverity, maxSeverity } from "../diagnostics/diagnostic.ts";
import { fmtMs } from "../util/format.ts";
import { ALL_RULES } from "./rules/index.ts";

/**
 * Run every enabled rule over the tree and assemble the result. Assumes
 * computeMetrics(tree) has already run. Rules that need data the plan lacks
 * (ANALYZE/BUFFERS) are skipped so cost-only plans degrade gracefully.
 */
export function runAdvisor(
  tree: PlanTree,
  config: PgExplainConfig = DEFAULT_CONFIG,
): AnalysisResult {
  const ctx: AnalysisContext = {
    tree,
    thresholds: config.thresholds,
    severityOf: (id, fallback) => config.rules[id]?.severity ?? fallback,
    isEnabled: (id) => config.rules[id]?.enabled !== false,
  };

  const nodes = flatten(tree.root);
  const diagnostics: Diagnostic[] = [];

  for (const rule of ALL_RULES) {
    if (!ctx.isEnabled(rule.id)) continue;
    if (rule.requiresAnalyze && !tree.hasAnalyze) continue;
    if (rule.requiresBuffers && !tree.hasBuffers) continue;
    for (const node of nodes) {
      for (const finding of rule.check(node, ctx)) diagnostics.push(finding);
    }
  }

  diagnostics.sort(bySeverity);

  let worst: Severity | null = null;
  for (const d of diagnostics) worst = worst === null ? d.severity : maxSeverity(worst, d.severity);

  const bn = bottlenecks(tree, 5);
  return {
    tree,
    diagnostics,
    bottlenecks: bn,
    verdict: buildVerdict(tree, diagnostics, bn),
    worstSeverity: worst,
  };
}

function buildVerdict(
  tree: PlanTree,
  diagnostics: Diagnostic[],
  bn: AnalysisResult["bottlenecks"],
): string {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;

  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} critical`);
  if (counts.warn) parts.push(`${counts.warn} warning${counts.warn > 1 ? "s" : ""}`);
  if (counts.info) parts.push(`${counts.info} note${counts.info > 1 ? "s" : ""}`);
  const findings = parts.length ? parts.join(", ") : "no issues found";

  const top = bn[0];
  let bottleneck = "";
  if (top?.metrics.selfMs !== undefined) {
    const pct =
      top.metrics.pctOfTotal !== undefined
        ? ` (${top.metrics.pctOfTotal.toFixed(0)}% of time)`
        : "";
    bottleneck = ` — top cost: ${nodeLabel(top)}${pct}`;
  }

  const ms = executionMs(tree);
  const timing = ms !== undefined ? ` Total ${fmtMs(ms)}.` : " Cost-only plan (no timing).";
  return `${findings}${bottleneck}.${timing}`;
}
