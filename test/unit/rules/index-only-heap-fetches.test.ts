import { describe, expect, it } from "vitest";
import { indexOnlyHeapFetches } from "../../../src/advisor/rules/index-only-heap-fetches.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_INDEX_ONLY_HEAP_FETCHES", () => {
  it("flags an index-only scan that falls back to the heap with a VACUUM fix", () => {
    const tree = loadTree("index-only-heap-fetches.json");
    const findings = runRule(indexOnlyHeapFetches, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_INDEX_ONLY_HEAP_FETCHES");
    expect(f.severity).toBe("info");
    expect(f.location?.relation).toBe("events");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/VACUUM/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/VACUUM/i);
    expect(f.meta?.heapFetches).toBe(8000);
    expect(f.docsUrl).toMatch(/indexes-index-only-scans/);
  });

  it("does not flag a plan without an index-only heap-fetch problem", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(indexOnlyHeapFetches, tree)).toHaveLength(0);
  });
});
