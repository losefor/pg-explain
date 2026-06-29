import type { PlanNode, PlanTree } from "../core/model.ts";
import { walk } from "../core/parse.ts";

/**
 * Strip literal values out of a plan so a shared report or CI artifact can't leak
 * real data. VERBOSE output and filter/condition expressions embed constants
 * (e.g. `status = 'shipped'`, `amount > 1000`) — those become `'?'` / `N`.
 *
 * ponytail: regex over expression strings, not a SQL parser. Catches string and
 * numeric literals, which is where real values live; identifiers/operators stay.
 */
export function redactExpression(expr: string): string {
  return expr
    .replace(/'(?:[^']|'')*'/g, "'?'") // string literals (with '' escapes)
    .replace(/\b\d+(?:\.\d+)?\b/g, "N"); // numeric literals
}

const EXPR_FIELDS = [
  "filter",
  "indexCond",
  "recheckCond",
  "hashCond",
  "joinFilter",
] as const satisfies readonly (keyof PlanNode)[];

function redactNode(node: PlanNode): void {
  for (const field of EXPR_FIELDS) {
    const value = node[field];
    if (typeof value === "string") (node[field] as string) = redactExpression(value);
  }
  if (node.output) node.output = node.output.map(redactExpression);
  if (node.sortKey) node.sortKey = node.sortKey.map(redactExpression);
}

/** Redact every expression field in the tree, in place. */
export function redactPlanTree(tree: PlanTree): void {
  walk(tree.root, redactNode);
}
