import { describe, expect, it } from "vitest";
import { triggerTime } from "../../../src/advisor/rules/trigger-time.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_TRIGGER_TIME", () => {
  it("flags significant trigger time with an actionable FK-indexing fix", () => {
    const tree = loadTree("trigger-time.json");
    const findings = runRule(triggerTime, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_TRIGGER_TIME");
    expect(f.severity).toBe("info");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/SET CONSTRAINTS ALL DEFERRED/);
    expect(f.remediation.commands?.some((c) => /CREATE INDEX/i.test(c.sql ?? ""))).toBe(true);
    expect(f.meta?.triggerPct).toBe(34);
    expect(f.docsUrl).toMatch(/postgresql\.org/);
  });

  it("does not flag a plan with no triggers", () => {
    const tree = loadTree("cost-only.json");
    expect(runRule(triggerTime, tree)).toHaveLength(0);
  });
});
