import { describe, expect, it } from "vitest";
import { hashSpillDisk } from "../../../src/advisor/rules/hash-spill-disk.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_HASH_SPILL_DISK", () => {
  it("flags a hash node that spilled to multiple batches with a work_mem fix", () => {
    const tree = loadTree("hash-spill-disk.json");
    const findings = runRule(hashSpillDisk, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_HASH_SPILL_DISK");
    expect(f.severity).toBe("warn");
    expect(f.location?.nodeType).toBe("Hash");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/work_mem/);
    // The recommended work_mem must be concrete and copy-pasteable.
    expect(f.remediation.commands?.[0]?.sql).toMatch(/SET work_mem = '\d+MB';/);
    expect(f.meta?.workMemRecommended).toBe("156MB");
    expect(f.meta?.hashBatches).toBe(8);
    expect(f.docsUrl).toMatch(/GUC-WORK-MEM/);
  });

  it("does not flag a plan with no spilling hash node", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(hashSpillDisk, tree)).toHaveLength(0);
  });
});
