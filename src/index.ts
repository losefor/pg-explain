/**
 * Public library API. Consumers can parse, analyze, and render plans programmatically:
 *
 *   import { analyze, render } from "pgexplain";
 *   const result = analyze(explainJsonText);
 *   console.log(render(result, { format: "markdown" }));
 */
import { runAdvisor } from "./advisor/index.ts";
import { DEFAULT_CONFIG, type PgExplainConfig } from "./config.ts";
import { computeMetrics } from "./core/metrics.ts";
import type { AnalysisResult, Diagnostic, PlanTree, Severity } from "./core/model.ts";
import { flatten, parseExplain } from "./core/parse.ts";
import { opDiagnostic, opError } from "./diagnostics/catalog.ts";
import { bySeverity, maxSeverity } from "./diagnostics/diagnostic.ts";
import { redactPlanTree } from "./input/redact.ts";
import { analyzeLocks } from "./locks/advisor.ts";

export interface AnalyzeOptions {
  config?: PgExplainConfig;
  /** 1-based statement index when the input holds more than one. */
  statement?: number;
  /** Strip literal values from expressions before analysis (no data leaks downstream). */
  redact?: boolean;
  /** The originating SQL — enables lock analysis (PGX_LOCK_* findings). */
  sql?: string;
}

/** Parse → (redact) → compute metrics → run advisor (+lock advisor) → attach notices. */
export function analyze(input: string, options: AnalyzeOptions = {}): AnalysisResult {
  const trees = parseExplain(input);
  const tree = selectStatement(trees, options.statement);
  if (options.redact) redactPlanTree(tree);
  computeMetrics(tree);

  const result = runAdvisor(tree, options.config ?? DEFAULT_CONFIG);

  const extra: Diagnostic[] = planNotices(tree);
  if (options.sql) extra.push(...analyzeLocks(options.sql, tree));
  if (extra.length) {
    result.diagnostics = [...result.diagnostics, ...extra].sort(bySeverity);
    result.worstSeverity = result.diagnostics.reduce<Severity | null>(
      (worst, d) => (worst === null ? d.severity : maxSeverity(worst, d.severity)),
      null,
    );
  }
  return result;
}

function selectStatement(trees: PlanTree[], statement?: number): PlanTree {
  if (statement !== undefined) {
    const tree = trees[statement - 1];
    if (!tree) {
      throw opError("PGX_MULTIPLE_STATEMENTS", {
        detail: `--statement ${statement} is out of range; the input has ${trees.length} statement(s).`,
      });
    }
    return tree;
  }
  const first = trees[0];
  if (!first) throw opError("PGX_UNEXPECTED_PLAN_SHAPE"); // schema guarantees ≥1, defensive
  return first;
}

/** Informational diagnostics about the plan's completeness (cost-only, no buffers, …). */
function planNotices(tree: PlanTree): Diagnostic[] {
  const notices: Diagnostic[] = [];
  if (!tree.hasAnalyze) notices.push(opDiagnostic("PGX_COST_ONLY_PLAN"));
  else if (!tree.hasBuffers) notices.push(opDiagnostic("PGX_NO_BUFFERS"));

  const nodes = flatten(tree.root);
  const trivial = nodes.length === 1 && /^(Result|Values? Scan)$/.test(tree.root.nodeType);
  if (trivial) notices.push(opDiagnostic("PGX_EMPTY_PLAN"));

  return notices;
}

export { runAdvisor } from "./advisor/index.ts";
export { DEFAULT_CONFIG, DEFAULT_THRESHOLDS, type PgExplainConfig } from "./config.ts";
export { bottlenecks, computeMetrics, executionMs, nodeLabel } from "./core/metrics.ts";
export type * from "./core/model.ts";
export { flatten, parseExplain, parseExplainJson, walk } from "./core/parse.ts";
export { AppError, scrubCredentials, severityAtLeast } from "./diagnostics/diagnostic.ts";
export { analyzeLocks } from "./locks/advisor.ts";
export { JSON_SCHEMA_VERSION } from "./report/json.ts";
export { FORMATS, type Format, isFormat, type RenderOptions, render } from "./report/render.ts";
export { ExitCode } from "./util/exit.ts";
