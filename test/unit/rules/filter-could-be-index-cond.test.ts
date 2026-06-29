import { describe, expect, it } from "vitest";
import { filterCouldBeIndexCond } from "../../../src/advisor/rules/filter-could-be-index-cond.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_FILTER_COULD_BE_INDEX_COND", () => {
  it("flags a residual filter on an index scan with an actionable index fix", () => {
    const tree = loadTree("filter-could-be-index-cond.json");
    const findings = runRule(filterCouldBeIndexCond, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_FILTER_COULD_BE_INDEX_COND");
    expect(f.severity).toBe("info");
    expect(f.location?.relation).toBe("orders");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/status = 'shipped'/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/CREATE INDEX/i);
    expect(f.docsUrl).toMatch(/indexes-multicolumn/);
  });

  it("does not flag a seq scan with no index condition", () => {
    const tree = loadTree("cost-only.json");
    expect(runRule(filterCouldBeIndexCond, tree)).toHaveLength(0);
  });
});
