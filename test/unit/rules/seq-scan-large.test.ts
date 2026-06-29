import { describe, expect, it } from "vitest";
import { seqScanLarge } from "../../../src/advisor/rules/seq-scan-large.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_SEQ_SCAN_LARGE", () => {
  it("flags a large sequential scan with an actionable index fix", () => {
    const tree = loadTree("seq-scan-large.json");
    const findings = runRule(seqScanLarge, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_SEQ_SCAN_LARGE");
    expect(f.severity).toBe("warn");
    expect(f.location?.relation).toBe("orders");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/CREATE INDEX/i);
    expect(f.docsUrl).toMatch(/postgresql\.org/);
  });

  it("does not flag a small sequential scan", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(seqScanLarge, tree)).toHaveLength(0);
  });
});
