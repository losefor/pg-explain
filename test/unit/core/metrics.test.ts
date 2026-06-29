import { describe, expect, it } from "vitest";
import { bottlenecks, executionMs } from "../../../src/core/metrics.ts";
import { loadTree } from "../helpers.ts";

describe("computeMetrics", () => {
  it("per-loop corrects rows and time, and computes self time", () => {
    const tree = loadTree("nested-loop.json");
    const root = tree.root; // Nested Loop
    const outer = root.children[0];
    const inner = root.children[1];

    // Inner runs once per outer row: Actual Rows × Actual Loops.
    expect(inner?.actualLoops).toBeGreaterThan(1);
    expect(inner?.metrics.totalRows).toBe((inner?.actualRows ?? 0) * (inner?.actualLoops ?? 0));

    // Self time excludes children and is clamped ≥ 0.
    for (const node of [root, outer, inner]) {
      expect(node?.metrics.selfMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes estimate factor with direction", () => {
    const tree = loadTree("seq-scan-large.json");
    const seq = tree.root.children[0];
    // Estimated 1000, actual 500000 → 500× underestimate.
    expect(seq?.metrics.estimateDirection).toBe("under");
    expect(seq?.metrics.estimateFactor).toBeCloseTo(500, 0);
  });

  it("computes cache-hit ratio from buffers", () => {
    const tree = loadTree("seq-scan-large.json");
    const seq = tree.root.children[0];
    // 120 hit / (120 + 5000) read ≈ 0.0234
    expect(seq?.metrics.cacheHitRatio).toBeCloseTo(120 / 5120, 4);
  });

  it("ranks bottlenecks by self time", () => {
    const tree = loadTree("seq-scan-large.json");
    const ranked = bottlenecks(tree, 5);
    expect(ranked[0]?.nodeType).toBe("Seq Scan");
    expect(executionMs(tree)).toBe(321.0);
  });

  it("leaves metrics empty on cost-only plans", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(tree.root.metrics.totalRows).toBe(50); // this fixture has actuals
    const cost = loadTree("cost-only.json");
    expect(cost.root.metrics.totalRows).toBeUndefined();
    expect(cost.root.metrics.selfMs).toBeUndefined();
  });
});
