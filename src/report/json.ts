import { executionMs } from "../core/metrics.ts";
import type { AnalysisResult, PlanNode, Severity } from "../core/model.ts";
import { flatten } from "../core/parse.ts";
import { nodeLabel } from "./tree.ts";

/** Bump on any breaking change to the JSON shape. Consumers can assert on it. */
export const JSON_SCHEMA_VERSION = 1;

/** Stable, machine-readable report for CI and tooling. */
export function renderJson(result: AnalysisResult, pretty = true): string {
  return JSON.stringify(buildReport(result), null, pretty ? 2 : 0);
}

/** The report object behind `renderJson` — used directly by the Studio HTTP API. */
export function buildReport(result: AnalysisResult): Record<string, unknown> {
  const { tree, diagnostics, bottlenecks } = result;

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;

  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    verdict: result.verdict,
    worstSeverity: result.worstSeverity,
    summary: {
      planningTimeMs: tree.planningTime ?? null,
      executionTimeMs: executionMs(tree) ?? null,
      hasAnalyze: tree.hasAnalyze,
      hasBuffers: tree.hasBuffers,
      nodeCount: flatten(tree.root).length,
      findings: counts,
    },
    diagnostics,
    bottlenecks: bottlenecks
      .filter((n) => (n.metrics.selfMs ?? 0) > 0)
      .map((n) => ({
        id: n.id,
        label: nodeLabel(n),
        nodeType: n.nodeType,
        relation: n.relationName ?? null,
        selfMs: n.metrics.selfMs ?? null,
        pctOfTotal: n.metrics.pctOfTotal ?? null,
        totalRows: n.metrics.totalRows ?? null,
      })),
    plan: serializeNode(tree.root),
  };
}

/** Slim node for JSON: normalized fields + metrics + children, never the raw blob. */
function serializeNode(node: PlanNode): Record<string, unknown> {
  const { children, metrics, raw, ...fields } = node;
  void raw;
  return { ...fields, metrics, children: children.map(serializeNode) };
}
