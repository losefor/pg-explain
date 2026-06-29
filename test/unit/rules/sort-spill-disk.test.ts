import { describe, expect, it } from "vitest";
import { sortSpillDisk } from "../../../src/advisor/rules/sort-spill-disk.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_SORT_SPILL_DISK", () => {
  it("flags a sort that spilled to disk with a concrete work_mem fix", () => {
    const tree = loadTree("sort-spill-disk.json");
    const findings = runRule(sortSpillDisk, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_SORT_SPILL_DISK");
    expect(f.severity).toBe("warn");
    expect(f.location?.nodeType).toBe("Sort");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    // 184320 KiB × 2.2 = 405504 KiB, rounded up to the next 4 MiB step → 400MB.
    expect(f.meta?.workMemRecommended).toBe("400MB");
    expect(f.meta?.sortSpaceUsedKiB).toBe(184320);
    expect(f.remediation.summary).toMatch(/work_mem = '400MB'/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/SET work_mem = '400MB'/);
    // Warn against a global change without accounting for connections.
    expect(f.remediation.summary).toMatch(/max_connections/);
    // Offer the index alternative on the sort key.
    expect(f.remediation.commands?.some((c) => /CREATE INDEX/i.test(c.sql ?? ""))).toBe(true);
    expect(f.docsUrl).toMatch(/GUC-WORK-MEM/);
  });

  it("does not flag an in-memory sort or a non-sort plan", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(sortSpillDisk, tree)).toHaveLength(0);
  });
});
