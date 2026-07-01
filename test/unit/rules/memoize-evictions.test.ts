import { describe, expect, it } from "vitest";
import { memoizeEvictions } from "../../../src/advisor/rules/memoize-evictions.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_MEMOIZE_EVICTIONS", () => {
  it("flags a thrashing Memoize cache with a work_mem remediation", () => {
    const tree = loadTree("memoize-evictions.json");
    const findings = runRule(memoizeEvictions, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_MEMOIZE_EVICTIONS");
    expect(f.severity).toBe("warn");
    expect(f.meta?.evictions).toBe(48100);
    // Every finding must be actionable.
    expect(f.remediation.summary).toMatch(/work_mem/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/work_mem/i);
    expect(f.docsUrl).toMatch(/postgresql\.org/);
  });

  it("stays quiet on plans without a Memoize node", () => {
    expect(runRule(memoizeEvictions, loadTree("nested-loop.json"))).toHaveLength(0);
  });
});
