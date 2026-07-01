import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiffResult, PlanNode } from "../lib/api.ts";
import { DiffPanel } from "./DiffPanel.tsx";

const node = (id: number, nodeType: string, relationName: string | null, children: PlanNode[] = []): PlanNode =>
  ({ id, nodeType, relationName, indexName: null, alias: null, children, metrics: { selfMs: 1, totalRows: 10 } }) as unknown as PlanNode;

const base: DiffResult = {
  beforeMs: 100,
  afterMs: 150,
  execDeltaMs: 50,
  execDeltaPct: 50,
  regressed: [{ signature: "Seq Scan on orders", beforeMs: 10, afterMs: 60, deltaMs: 50, deltaPct: 500 }],
  improved: [],
  added: [],
  removed: [],
  newFindings: [],
  resolvedFindings: [],
};

describe("DiffPanel", () => {
  it("shows the regression headline and delta rows", () => {
    render(<DiffPanel diff={base} onClose={() => {}} />);
    expect(screen.getByText(/50\.0 ms slower/)).toBeDefined();
    expect(screen.getByText("Regressed (slower)")).toBeDefined();
    expect(screen.queryByText("Plans side by side")).toBeNull();
  });

  it("renders the side-by-side trees when both plans are present", () => {
    const diff: DiffResult = {
      ...base,
      beforePlan: node(1, "Seq Scan", "orders"),
      afterPlan: node(1, "Index Scan", "orders"),
    };
    render(<DiffPanel diff={diff} onClose={() => {}} />);
    expect(screen.getByText("Plans side by side")).toBeDefined();
    expect(screen.getByText("Before")).toBeDefined();
    expect(screen.getByText("After")).toBeDefined();
    // "Seq Scan on orders" appears in both the regressed list and the before tree.
    expect(screen.getAllByText(/Seq Scan on orders/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Index Scan on orders/)).toBeDefined();
  });
});
