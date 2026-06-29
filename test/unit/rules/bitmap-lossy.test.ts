import { describe, expect, it } from "vitest";
import { bitmapLossy } from "../../../src/advisor/rules/bitmap-lossy.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_BITMAP_LOSSY", () => {
  it("flags a lossy bitmap heap scan with a work_mem fix", () => {
    const tree = loadTree("bitmap-lossy.json");
    const findings = runRule(bitmapLossy, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_BITMAP_LOSSY");
    expect(f.severity).toBe("info");
    expect(f.location?.relation).toBe("events");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/work_mem/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/SET work_mem/i);
    expect(f.docsUrl).toMatch(/GUC-WORK-MEM/);
    expect(f.meta?.lossyBlocks).toBe(24500);
    expect(f.meta?.exactBlocks).toBe(1200);
  });

  it("does not flag a plan without a lossy bitmap", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(bitmapLossy, tree)).toHaveLength(0);
  });
});
