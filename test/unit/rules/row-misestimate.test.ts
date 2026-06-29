import { describe, expect, it } from "vitest";
import { rowMisestimate } from "../../../src/advisor/rules/row-misestimate.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_ROW_MISESTIMATE", () => {
  it("flags a large row underestimate with an actionable statistics fix", () => {
    const tree = loadTree("row-misestimate.json");
    const findings = runRule(rowMisestimate, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_ROW_MISESTIMATE");
    // Underestimates are the dangerous direction, so they escalate to warn.
    expect(f.severity).toBe("warn");
    expect(f.location?.relation).toBe("orders");
    // 1000 estimated vs 500000 actual → 500x.
    expect(f.title).toMatch(/500x row underestimate on orders/);
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/ANALYZE orders/);
    expect(f.remediation.commands?.some((c) => /ANALYZE orders;/.test(c.sql ?? ""))).toBe(true);
    expect(f.remediation.commands?.some((c) => /SET STATISTICS 1000/.test(c.sql ?? ""))).toBe(true);
    expect(f.remediation.commands?.some((c) => /CREATE STATISTICS/.test(c.sql ?? ""))).toBe(true);
    expect(f.docsUrl).toMatch(/planner-stats\.html/);
  });

  it("does not flag an accurate cost-only plan", () => {
    const tree = loadTree("cost-only.json");
    expect(runRule(rowMisestimate, tree)).toHaveLength(0);
  });
});
