import { executionMs, nodeLabel } from "./metrics.ts";
import type { AnalysisResult, Diagnostic, PlanNode } from "./model.ts";
import { walk } from "./parse.ts";

export interface SignatureDelta {
  signature: string;
  beforeMs: number;
  afterMs: number;
  deltaMs: number;
  /** Positive = slower in "after". */
  deltaPct: number | null;
}

export interface DiffResult {
  beforeMs: number | undefined;
  afterMs: number | undefined;
  execDeltaMs: number | undefined;
  execDeltaPct: number | undefined;
  /** Whether both plans had ANALYZE timing (otherwise deltas use cost as a proxy). */
  timed: boolean;
  regressed: SignatureDelta[];
  improved: SignatureDelta[];
  added: SignatureDelta[];
  removed: SignatureDelta[];
  newFindings: Diagnostic[];
  resolvedFindings: Diagnostic[];
}

/** Self time if available, else self cost (totalCost minus children) as a proxy. */
function weight(node: PlanNode): number {
  if (node.metrics.selfMs !== undefined) return node.metrics.selfMs;
  const own = node.totalCost ?? 0;
  let children = 0;
  for (const c of node.children) children += c.totalCost ?? 0;
  return Math.max(own - children, 0);
}

/** A stable key for matching nodes across two plans of the same query. */
function signature(node: PlanNode): string {
  return nodeLabel(node);
}

function weightBySignature(result: AnalysisResult): Map<string, number> {
  const map = new Map<string, number>();
  walk(result.tree.root, (node) => {
    const key = signature(node);
    map.set(key, (map.get(key) ?? 0) + weight(node));
  });
  return map;
}

function findingKey(d: Diagnostic): string {
  return `${d.code}|${d.location?.relation ?? ""}`;
}

/** Compare two analyzed plans (before → after). Pure. */
export function diffAnalyses(before: AnalysisResult, after: AnalysisResult): DiffResult {
  const beforeMs = executionMs(before.tree);
  const afterMs = executionMs(after.tree);
  const timed = before.tree.hasAnalyze && after.tree.hasAnalyze;

  let execDeltaMs: number | undefined;
  let execDeltaPct: number | undefined;
  if (beforeMs !== undefined && afterMs !== undefined) {
    execDeltaMs = afterMs - beforeMs;
    execDeltaPct = beforeMs > 0 ? (100 * execDeltaMs) / beforeMs : undefined;
  }

  const beforeMap = weightBySignature(before);
  const afterMap = weightBySignature(after);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const regressed: SignatureDelta[] = [];
  const improved: SignatureDelta[] = [];
  const added: SignatureDelta[] = [];
  const removed: SignatureDelta[] = [];

  for (const key of keys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    const beforeVal = b ?? 0;
    const afterVal = a ?? 0;
    const deltaMs = afterVal - beforeVal;
    const deltaPct = beforeVal > 0 ? (100 * deltaMs) / beforeVal : null;
    const entry: SignatureDelta = {
      signature: key,
      beforeMs: beforeVal,
      afterMs: afterVal,
      deltaMs,
      deltaPct,
    };

    if (b === undefined) added.push(entry);
    else if (a === undefined) removed.push(entry);
    else if (deltaMs > 0.0001) regressed.push(entry);
    else if (deltaMs < -0.0001) improved.push(entry);
  }

  regressed.sort((x, y) => y.deltaMs - x.deltaMs);
  improved.sort((x, y) => x.deltaMs - y.deltaMs);
  added.sort((x, y) => y.afterMs - x.afterMs);
  removed.sort((x, y) => y.beforeMs - x.beforeMs);

  const beforeKeys = new Set(before.diagnostics.map(findingKey));
  const afterKeys = new Set(after.diagnostics.map(findingKey));
  const newFindings = after.diagnostics.filter((d) => !beforeKeys.has(findingKey(d)));
  const resolvedFindings = before.diagnostics.filter((d) => !afterKeys.has(findingKey(d)));

  return {
    beforeMs,
    afterMs,
    execDeltaMs,
    execDeltaPct,
    timed,
    regressed,
    improved,
    added,
    removed,
    newFindings,
    resolvedFindings,
  };
}
