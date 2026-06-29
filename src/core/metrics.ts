import type { PlanNode, PlanTree } from "./model.ts";
import { flatten, walk } from "./parse.ts";

/**
 * Fill `node.metrics` for every node. All row/time figures are PER-LOOP corrected:
 * Postgres reports "Actual Rows"/"Actual Total Time" as the average of a single loop,
 * so the true total is `× "Actual Loops"`. Buffer counters are already cumulative and
 * are NOT multiplied. No-ops cleanly on cost-only plans (leaves metrics empty).
 */
export function computeMetrics(tree: PlanTree): void {
  // Pass 1 — per-node quantities that don't depend on siblings/children.
  walk(tree.root, (node) => {
    const { actualRows, actualLoops, actualTotalTime } = node;

    if (actualRows !== undefined && actualLoops !== undefined) {
      node.metrics.totalRows = actualRows * actualLoops;
    }
    if (actualTotalTime !== undefined && actualLoops !== undefined) {
      node.metrics.inclusiveMs = actualTotalTime * actualLoops;
    }

    // Estimate vs actual (only meaningful with actuals).
    if (node.metrics.totalRows !== undefined) {
      const est = Math.max(node.planRows, 1);
      const act = Math.max(node.metrics.totalRows, 1);
      node.metrics.estimateFactor = est >= act ? est / act : act / est;
      node.metrics.estimateDirection =
        node.planRows > node.metrics.totalRows
          ? "over"
          : node.metrics.totalRows > node.planRows
            ? "under"
            : "accurate";
    }

    // Cache-hit ratio from shared buffers (cumulative — no ×loops).
    const hit = node.sharedHitBlocks ?? 0;
    const read = node.sharedReadBlocks ?? 0;
    node.metrics.cacheHitRatio = hit + read > 0 ? hit / (hit + read) : null;

    // Filter discard ratio (per-loop corrected).
    if (node.rowsRemovedByFilter !== undefined && actualLoops !== undefined) {
      const removed = node.rowsRemovedByFilter * actualLoops;
      const kept = node.metrics.totalRows ?? 0;
      const denom = removed + kept;
      if (denom > 0) node.metrics.filterDiscardRatio = removed / denom;
    }

    // Bitmap lossy ratio.
    if (node.lossyHeapBlocks !== undefined) {
      const lossy = node.lossyHeapBlocks;
      const exact = node.exactHeapBlocks ?? 0;
      const denom = lossy + exact;
      if (denom > 0) node.metrics.lossyRatio = lossy / denom;
    }
  });

  // Pass 2 — self time = inclusive − Σ(children inclusive), clamped ≥ 0.
  walk(tree.root, (node) => {
    if (node.metrics.inclusiveMs === undefined) return;
    let childrenMs = 0;
    for (const child of node.children) childrenMs += child.metrics.inclusiveMs ?? 0;
    node.metrics.selfMs = Math.max(node.metrics.inclusiveMs - childrenMs, 0);
  });

  // Pass 3 — % of total execution time.
  const totalMs = executionMs(tree);
  if (totalMs && totalMs > 0) {
    walk(tree.root, (node) => {
      if (node.metrics.selfMs !== undefined) {
        node.metrics.pctOfTotal = (100 * node.metrics.selfMs) / totalMs;
      }
    });
  }
}

/** Total execution time in ms: prefer the reported value, else the root's inclusive time. */
export function executionMs(tree: PlanTree): number | undefined {
  return tree.executionTime ?? tree.root.metrics.inclusiveMs;
}

/** Top N nodes by self time (the real bottlenecks), descending. */
export function bottlenecks(tree: PlanTree, n = 5): PlanNode[] {
  return flatten(tree.root)
    .filter((node) => node.metrics.selfMs !== undefined)
    .sort((a, b) => (b.metrics.selfMs ?? 0) - (a.metrics.selfMs ?? 0))
    .slice(0, n);
}

/** A short human label for a node, e.g. "Seq Scan on orders". */
export function nodeLabel(node: PlanNode): string {
  let label = node.nodeType;
  if (node.indexName && node.relationName)
    label += ` using ${node.indexName} on ${node.relationName}`;
  else if (node.relationName) label += ` on ${node.relationName}`;
  if (node.alias && node.alias !== node.relationName) label += ` (${node.alias})`;
  return label;
}
