import { describe, expect, it } from "vitest";
import type { PlanNode } from "./api.ts";
import { collectHeat, heatPercent, numberToColorHsl } from "./heat.ts";

const node = (id: number, over: Partial<Record<string, unknown>> = {}, children: PlanNode[] = []): PlanNode =>
  ({
    id,
    children,
    metrics: { selfMs: over.selfMs ?? null, totalRows: over.totalRows ?? null },
    totalCost: over.totalCost ?? null,
    actualRows: over.actualRows ?? null,
    sharedHitBlocks: over.sharedHitBlocks ?? null,
    sharedReadBlocks: over.sharedReadBlocks ?? null,
    sharedDirtiedBlocks: null,
    sharedWrittenBlocks: null,
  }) as unknown as PlanNode;

describe("numberToColorHsl", () => {
  it("maps 0 → green and 100 → red, clamping out-of-range values", () => {
    expect(numberToColorHsl(0)).toBe("hsl(120 85% 45%)");
    expect(numberToColorHsl(100)).toBe("hsl(0 85% 45%)");
    expect(numberToColorHsl(-50)).toBe("hsl(120 85% 45%)");
    expect(numberToColorHsl(400)).toBe("hsl(0 85% 45%)");
  });
});

describe("collectHeat / heatPercent", () => {
  it("computes exclusive cost and buffers against children", () => {
    const child = node(2, { totalCost: 40, selfMs: 5, sharedHitBlocks: 10 });
    const root = node(1, { totalCost: 100, selfMs: 15, sharedHitBlocks: 30 }, [child]);
    const { values, max } = collectHeat(root);

    // Root cost is exclusive of its child's: 100 - 40.
    expect(values.get(1)?.cost).toBe(60);
    expect(values.get(2)?.cost).toBe(40);
    // Buffers likewise: 30 - 10.
    expect(values.get(1)?.buffers).toBe(20);
    expect(max.duration).toBe(15);

    expect(heatPercent(1, "duration", values, max)).toBe(100);
    expect(heatPercent(2, "duration", values, max)).toBeCloseTo((5 / 15) * 100);
    expect(heatPercent(1, "none", values, max)).toBe(0);
  });

  it("never returns negative exclusive values", () => {
    // Parallel plans can report child cost above the parent's.
    const child = node(2, { totalCost: 100 });
    const root = node(1, { totalCost: 50 }, [child]);
    const { values } = collectHeat(root);
    expect(values.get(1)?.cost).toBe(0);
  });

  it("unknown node id yields 0%", () => {
    const { values, max } = collectHeat(node(1, { selfMs: 10 }));
    expect(heatPercent(99, "duration", values, max)).toBe(0);
  });
});
