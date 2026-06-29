import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_THRESHOLDS } from "../../src/config.ts";
import { computeMetrics } from "../../src/core/metrics.ts";
import type { AnalysisContext, Diagnostic, PlanTree, Rule } from "../../src/core/model.ts";
import { flatten, parseExplainJson } from "../../src/core/parse.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** Load a fixture, parse it, and compute metrics — ready for a rule or renderer. */
export function loadTree(fixture: string): PlanTree {
  const text = readFileSync(FIXTURES + fixture, "utf8");
  const tree = parseExplainJson(text)[0];
  if (!tree) throw new Error(`fixture ${fixture} produced no plan`);
  computeMetrics(tree);
  return tree;
}

/** A default analysis context (no config overrides, everything enabled). */
export function ctxFor(tree: PlanTree): AnalysisContext {
  return {
    tree,
    thresholds: DEFAULT_THRESHOLDS,
    severityOf: (_id, fallback) => fallback,
    isEnabled: () => true,
  };
}

/** Run one rule over every node of a tree and collect its findings. */
export function runRule(rule: Rule, tree: PlanTree): Diagnostic[] {
  const ctx = ctxFor(tree);
  return flatten(tree.root).flatMap((node) => rule.check(node, ctx));
}
