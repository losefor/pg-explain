import { executionMs, nodeLabel } from "../core/metrics.ts";
import type { PlanNode, PlanTree } from "../core/model.ts";
import { fmtInt, fmtMs, type TreeGlyphs } from "../util/format.ts";

export interface TreeLine {
  node: PlanNode;
  /** Indentation + branch glyphs already applied. */
  prefix: string;
}

/** Lay out the plan as indented lines. Shared by the markdown/terminal/text renderers. */
export function treeLines(tree: PlanTree, glyphs: TreeGlyphs): TreeLine[] {
  const lines: TreeLine[] = [];
  const recurse = (node: PlanNode, indent: string, isLast: boolean, isRoot: boolean): void => {
    const connector = isRoot ? "" : isLast ? glyphs.last : glyphs.branch;
    lines.push({ node, prefix: indent + connector });
    const childIndent = isRoot ? "" : indent + (isLast ? glyphs.space : glyphs.vert);
    node.children.forEach((child, i) => {
      recurse(child, childIndent, i === node.children.length - 1, false);
    });
  };
  recurse(tree.root, "", true, true);
  return lines;
}

/** A compact, plain-text metric summary for one node (no color). */
export function nodeSummary(node: PlanNode): string {
  const m = node.metrics;
  const parts: string[] = [];

  if (m.totalRows !== undefined) {
    let rows = `rows=${fmtInt(m.totalRows)}`;
    if (
      m.estimateFactor !== undefined &&
      m.estimateFactor >= 2 &&
      m.estimateDirection !== "accurate"
    ) {
      rows += ` (est ${fmtInt(node.planRows)}, ${m.estimateFactor.toFixed(0)}× ${m.estimateDirection})`;
    }
    parts.push(rows);
  } else {
    parts.push(`rows≈${fmtInt(node.planRows)} est`);
  }

  if (m.selfMs !== undefined) {
    let t = `self ${fmtMs(m.selfMs)}`;
    if (m.pctOfTotal !== undefined && m.pctOfTotal >= 1) t += ` (${m.pctOfTotal.toFixed(0)}%)`;
    parts.push(t);
  }

  if (node.metrics.cacheHitRatio != null) {
    parts.push(`cache ${(node.metrics.cacheHitRatio * 100).toFixed(0)}%`);
  }

  return parts.join(" · ");
}

export { executionMs, nodeLabel };
