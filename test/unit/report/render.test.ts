import { describe, expect, it } from "vitest";
import { runAdvisor } from "../../../src/advisor/index.ts";
import { computeMetrics } from "../../../src/core/metrics.ts";
import { analyze } from "../../../src/index.ts";
import { render } from "../../../src/report/render.ts";
import { configureColor } from "../../../src/util/color.ts";
import { loadTree } from "../helpers.ts";

// Deterministic golden output: no ANSI.
configureColor("never");

const FIXTURES = [
  "seq-scan-large.json",
  "sort-spill-disk.json",
  "cost-only.json",
  "nested-loop-large-outer.json",
  "significant-jit.json",
];

describe("renderers (snapshot)", () => {
  for (const fixture of FIXTURES) {
    for (const format of ["terminal", "markdown", "json", "text"] as const) {
      it(`${fixture} → ${format}`, () => {
        const tree = loadTree(fixture);
        const result = runAdvisor(tree);
        expect(render(result, { format })).toMatchSnapshot();
      });
    }
  }

  it("html output is stable (snapshot)", () => {
    const result = runAdvisor(loadTree("seq-scan-large.json"));
    expect(render(result, { format: "html" })).toMatchSnapshot();
  });

  it("tldr trims the plan tree but keeps findings", () => {
    const result = runAdvisor(loadTree("seq-scan-large.json"));
    const full = render(result, { format: "markdown" });
    const tldr = render(result, { format: "markdown", tldr: true });
    expect(tldr.length).toBeLessThan(full.length);
    expect(tldr).toMatchSnapshot();
  });

  it("html is self-contained (inline style, no external assets)", () => {
    const result = analyze(
      '[{"Plan":{"Node Type":"Seq Scan","Relation Name":"t","Plan Rows":200000,"Actual Rows":200000,"Actual Loops":1,"Actual Total Time":50,"Filter":"(a = 1)","Rows Removed by Filter":100000},"Execution Time":51}]',
    );
    const html = render(result, { format: "html" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/i);
  });
});

describe("library analyze()", () => {
  it("computes metrics and findings end to end", () => {
    const result = analyze(
      JSON.stringify([
        {
          Plan: {
            "Node Type": "Seq Scan",
            "Relation Name": "t",
            "Plan Rows": 10,
            "Actual Rows": 500000,
            "Actual Loops": 1,
            "Actual Total Time": 100,
          },
          "Execution Time": 100,
        },
      ]),
    );
    expect(result.diagnostics.some((d) => d.code === "PGX_SEQ_SCAN_LARGE")).toBe(true);
    expect(result.tree.root.metrics.selfMs).toBeGreaterThan(0);
    void computeMetrics; // imported for type coverage of the public surface
  });
});
