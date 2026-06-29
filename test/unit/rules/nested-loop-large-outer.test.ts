import { describe, expect, it } from "vitest";
import { nestedLoopLargeOuter } from "../../../src/advisor/rules/nested-loop-large-outer.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_NESTED_LOOP_LARGE_OUTER", () => {
  it("flags a nested loop driven by a large outer side with a cardinality-first fix", () => {
    const tree = loadTree("nested-loop-large-outer.json");
    const findings = runRule(nestedLoopLargeOuter, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_NESTED_LOOP_LARGE_OUTER");
    expect(f.severity).toBe("warn");
    expect(f.location?.nodeType).toBe("Nested Loop");
    expect(f.meta?.outerRows).toBe(50000);
    // Every finding must be actionable, and name the driving table to re-ANALYZE.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/events/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/ANALYZE events/i);
    expect(f.docsUrl).toMatch(/runtime-config-query\.html/);
  });

  it("does not flag a plan without a large-outer nested loop", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(nestedLoopLargeOuter, tree)).toHaveLength(0);
  });
});
