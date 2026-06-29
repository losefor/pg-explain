import { describe, expect, it } from "vitest";
import { redactExpression, redactPlanTree } from "../../../src/input/redact.ts";
import { loadTree } from "../helpers.ts";

describe("redactExpression", () => {
  it("replaces string and numeric literals, keeps structure", () => {
    expect(redactExpression("(status = 'shipped'::text AND amount > 1000)")).toBe(
      "(status = '?'::text AND amount > N)",
    );
  });
  it("handles escaped quotes", () => {
    expect(redactExpression("name = 'O''Brien'")).toBe("name = '?'");
  });
});

describe("redactPlanTree", () => {
  it("redacts expression fields across the tree", () => {
    const tree = loadTree("seq-scan-large.json");
    redactPlanTree(tree);
    const seq = tree.root.children[0];
    expect(seq?.filter).not.toContain("shipped");
    expect(seq?.filter).toContain("'?'");
  });
});
