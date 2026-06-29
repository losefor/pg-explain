import { describe, expect, it } from "vitest";
import { couldBeIndexOnly } from "../../../src/advisor/rules/could-be-index-only.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_COULD_BE_INDEX_ONLY", () => {
  it("hints that a filter-free, few-column index scan may go index-only", () => {
    const tree = loadTree("could-be-index-only.json");
    const findings = runRule(couldBeIndexOnly, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_COULD_BE_INDEX_ONLY");
    expect(f.severity).toBe("info");
    expect(f.location?.relation).toBe("orders");
    // Low-confidence hint, but still actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/INCLUDE/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/CREATE INDEX/i);
    expect(f.remediation.commands?.[1]?.sql).toMatch(/VACUUM/i);
    expect(f.docsUrl).toMatch(/indexes-index-only-scans/);
  });

  it("does not fire on a sequential scan", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(couldBeIndexOnly, tree)).toHaveLength(0);
  });
});
