import { describe, expect, it } from "vitest";
import { significantJit } from "../../../src/advisor/rules/significant-jit.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_SIGNIFICANT_JIT", () => {
  it("flags JIT compilation that dominates a short query's execution", () => {
    const tree = loadTree("significant-jit.json");
    const findings = runRule(significantJit, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_SIGNIFICANT_JIT");
    expect(f.severity).toBe("info");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/jit_above_cost/);
    expect(f.remediation.commands?.some((c) => /SET jit = off/i.test(c.sql ?? ""))).toBe(true);
    expect(f.docsUrl).toMatch(/GUC-JIT-ABOVE-COST/);
    expect(f.meta?.jitPct).toBe(79);
  });

  it("does not flag a plan with no JIT timing", () => {
    const tree = loadTree("cost-only.json");
    expect(runRule(significantJit, tree)).toHaveLength(0);
  });
});
