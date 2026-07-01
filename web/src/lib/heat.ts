import type { PlanNode } from "./api.ts";

export type HeatMode = "none" | "duration" | "rows" | "cost" | "buffers";

export const HEAT_MODES: { id: HeatMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "duration", label: "Time" },
  { id: "rows", label: "Rows" },
  { id: "cost", label: "Cost" },
  { id: "buffers", label: "Buffers" },
];

/** Green (low) → red (high), matching pev2's numberToColorHsl. `pct` is 0–100. */
export function numberToColorHsl(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const hue = ((100 - clamped) * 1.2).toFixed(0); // 120=green → 0=red
  return `hsl(${hue} 85% 45%)`;
}

export interface HeatValues {
  duration: number;
  rows: number;
  cost: number;
  buffers: number;
}

const sharedBlocks = (n: PlanNode): number =>
  (n.sharedHitBlocks ?? 0) + (n.sharedReadBlocks ?? 0) + (n.sharedDirtiedBlocks ?? 0) + (n.sharedWrittenBlocks ?? 0);

/** Per-node heat values (exclusive where meaningful) and the max of each across the tree. */
export function collectHeat(root: PlanNode): { values: Map<number, HeatValues>; max: HeatValues } {
  const values = new Map<number, HeatValues>();
  const max: HeatValues = { duration: 0, rows: 0, cost: 0, buffers: 0 };
  const visit = (n: PlanNode) => {
    const childCost = n.children.reduce((s, c) => s + (c.totalCost ?? 0), 0);
    const childBuffers = n.children.reduce((s, c) => s + sharedBlocks(c), 0);
    const v: HeatValues = {
      duration: n.metrics.selfMs ?? 0, // already exclusive
      rows: n.metrics.totalRows ?? n.actualRows ?? 0,
      cost: Math.max((n.totalCost ?? 0) - childCost, 0),
      buffers: Math.max(sharedBlocks(n) - childBuffers, 0),
    };
    values.set(n.id, v);
    max.duration = Math.max(max.duration, v.duration);
    max.rows = Math.max(max.rows, v.rows);
    max.cost = Math.max(max.cost, v.cost);
    max.buffers = Math.max(max.buffers, v.buffers);
    n.children.forEach(visit);
  };
  visit(root);
  return { values, max };
}

/** Percentage (0–100) of a node's value against the tree max for the given mode. */
export function heatPercent(
  id: number,
  mode: HeatMode,
  values: Map<number, HeatValues>,
  max: HeatValues,
): number {
  if (mode === "none") return 0;
  const v = values.get(id)?.[mode] ?? 0;
  const m = max[mode] || 1;
  return (v / m) * 100;
}
