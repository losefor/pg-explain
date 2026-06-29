import { describe, expect, it } from "vitest";
import { lowCacheHit } from "../../../src/advisor/rules/low-cache-hit.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_LOW_CACHE_HIT", () => {
  it("flags a node with a low cache hit ratio and heavy disk reads", () => {
    const tree = loadTree("low-cache-hit.json");
    const findings = runRule(lowCacheHit, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_LOW_CACHE_HIT");
    expect(f.severity).toBe("info");
    expect(f.location?.relation).toBe("page_views");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/re-run/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/SHOW shared_buffers/i);
    expect(f.meta?.readBlocks).toBe(4800);
    expect(f.docsUrl).toMatch(/GUC-SHARED-BUFFERS/);
  });

  it("does not flag a node whose pages came from cache", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(lowCacheHit, tree)).toHaveLength(0);
  });
});
