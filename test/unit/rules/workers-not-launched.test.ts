import { describe, expect, it } from "vitest";
import { workersNotLaunched } from "../../../src/advisor/rules/workers-not-launched.ts";
import { loadTree, runRule } from "../helpers.ts";

describe("PGX_WORKERS_NOT_LAUNCHED", () => {
  it("flags a Gather that got fewer workers than planned with a pool-tuning fix", () => {
    const tree = loadTree("workers-not-launched.json");
    const findings = runRule(workersNotLaunched, tree);

    expect(findings).toHaveLength(1);
    const f = findings[0];
    if (!f) throw new Error("expected a finding");
    expect(f.code).toBe("PGX_WORKERS_NOT_LAUNCHED");
    expect(f.severity).toBe("info");
    expect(f.location?.nodeType).toBe("Gather");
    // Every finding must be actionable.
    expect(f.remediation.summary.length).toBeGreaterThan(0);
    expect(f.remediation.summary).toMatch(/max_parallel_workers/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/ALTER SYSTEM SET max_parallel_workers/);
    expect(f.remediation.commands?.[0]?.sql).toMatch(/pg_reload_conf\(\)/);
    expect(f.docsUrl).toMatch(/postgresql\.org/);
    expect(f.meta).toMatchObject({ planned: 4, launched: 1 });
  });

  it("does not flag a plan with no Gather node", () => {
    const tree = loadTree("small-seq-scan.json");
    expect(runRule(workersNotLaunched, tree)).toHaveLength(0);
  });
});
