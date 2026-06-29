import { describe, expect, it } from "vitest";
import { correlatedSubplan } from "../../../src/advisor/rules/correlated-subplan.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_CORRELATED_SUBPLAN", () => {
  it("flags a subplan re-executed per outer row with a de-correlation fix", () => {
    const tree = loadTree("correlated-subplan.json");
    const findings = runRule(correlatedSubplan, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_CORRELATED_SUBPLAN");
    expect(f.severity).toBe("warn");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/LATERAL/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/CREATE INDEX/i);
    expect(f.meta?.loops).toBe(5000);
    expect(f.docsUrl).toMatch(/QUERIES-LATERAL/);
  });

  it("does not flag a plan with no correlated subplan", () => {
    const tree = loadTree("seq-scan-large.json");
    expect(runRule(correlatedSubplan, tree)).toHaveLength(0);
  });
});
