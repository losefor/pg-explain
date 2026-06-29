import { describe, expect, it } from "vitest";
import { highFilterDiscard } from "../../../src/advisor/rules/high-filter-discard.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_HIGH_FILTER_DISCARD", () => {
  it("flags a node whose filter discards most rows with an index fix", () => {
    const tree = loadTree("high-filter-discard.json");
    const findings = runRule(highFilterDiscard, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_HIGH_FILTER_DISCARD");
    expect(f.severity).toBe("warn");
    expect(f.location?.relation).toBe("events");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/Index Cond/);
    expect(f.remediation.commands?.some((c) => /CREATE INDEX .* WHERE/i.test(c.sql ?? ""))).toBe(
      true,
    );
    expect(f.detail).toMatch(/event_type/);
    expect(f.docsUrl).toMatch(/indexes-partial\.html/);
    expect(f.meta?.discardPct).toBeGreaterThan(90);
  });

  it("does not flag a small sequential scan with no heavy filter", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(highFilterDiscard, tree)).toHaveLength(0);
  });
});
