import { describe, expect, it } from "vitest";
import { cartesianProduct } from "../../../src/advisor/rules/cartesian-product.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_CARTESIAN_PRODUCT", () => {
  it("flags a Nested Loop with no join condition and a concrete join fix", () => {
    const tree = loadTree("cartesian-product.json");
    const findings = runRule(cartesianProduct, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_CARTESIAN_PRODUCT");
    expect(f.severity).toBe("error");
    expect(f.location?.nodeType).toBe("Nested Loop");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/join condition/i);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/JOIN .*ON/is);
    expect(f.docsUrl).toMatch(/queries-table-expressions/);
  });

  it("does not flag a plain sequential scan", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(cartesianProduct, tree)).toHaveLength(0);
  });

  it("looks through Memoize to the parameterized inner scan (no false positive)", () => {
    // Nested Loop → Memoize → Index Scan (id = events.user_id): a real join key.
    const tree = loadTree("memoize-evictions.json");
    expect(runRule(cartesianProduct, tree)).toHaveLength(0);
  });
});
