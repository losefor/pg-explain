import { describe, expect, it } from "vitest";
import { limitLargeOffset } from "../../../src/advisor/rules/limit-large-offset.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_LIMIT_LARGE_OFFSET", () => {
  it("flags a Limit that discards a large generated prefix", () => {
    const tree = loadTree("limit-large-offset.json");
    const findings = runRule(limitLargeOffset, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_LIMIT_LARGE_OFFSET");
    expect(f.severity).toBe("warn");
    expect(f.meta?.discarded).toBe(100000);
    // Every finding must be actionable.
    expect(f.remediation.summary).toMatch(/keyset/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/ORDER BY/i);
    expect(f.docsUrl).toMatch(/postgresql\.org/);
  });

  it("does not flag a top-N Limit whose input stopped early", () => {
    // sort-spill-disk: Limit emits 100 rows and its Sort child also produced 100.
    const tree = loadTree("sort-spill-disk.json");
    expect(runRule(limitLargeOffset, tree)).toHaveLength(0);
  });
});
