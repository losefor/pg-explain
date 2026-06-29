import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffAnalyses } from "../../../src/core/diff.ts";
import { analyze } from "../../../src/index.ts";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const load = (f: string) => analyze(readFileSync(FIXTURES + f, "utf8"));

describe("diffAnalyses", () => {
  it("reports a faster 'after' as an improvement", () => {
    const before = load("seq-scan-large.json"); // 321ms
    const after = load("nested-loop.json"); // 181.5ms
    const diff = diffAnalyses(before, after);

    expect(diff.beforeMs).toBe(321);
    expect(diff.afterMs).toBe(181.5);
    expect(diff.execDeltaMs).toBeLessThan(0);
    expect(diff.execDeltaPct).toBeLessThan(0);
    expect(diff.timed).toBe(true);
  });

  it("reports a slower 'after' as a regression", () => {
    const before = load("nested-loop.json");
    const after = load("seq-scan-large.json");
    const diff = diffAnalyses(before, after);
    expect(diff.execDeltaMs).toBeGreaterThan(0);
    expect(diff.execDeltaPct).toBeGreaterThan(0);
  });

  it("tracks new and resolved findings by code", () => {
    const before = load("small-seq-scan.json"); // clean
    const after = load("seq-scan-large.json"); // has findings
    const diff = diffAnalyses(before, after);
    expect(diff.newFindings.some((d) => d.code === "PGX_SEQ_SCAN_LARGE")).toBe(true);
    expect(diff.resolvedFindings.length).toBe(0);
  });
});
