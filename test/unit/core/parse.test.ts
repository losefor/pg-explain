import { describe, expect, it } from "vitest";
import { flatten, parseExplainJson } from "../../../src/core/parse.ts";
import { AppError } from "../../../src/diagnostics/diagnostic.ts";
import { loadTree } from "../helpers.ts";

describe("parseExplainJson", () => {
  it("normalizes a standard FORMAT JSON plan", () => {
    const tree = loadTree("seq-scan-large.json");
    expect(tree.root.nodeType).toBe("Aggregate");
    expect(tree.hasAnalyze).toBe(true);
    expect(tree.hasBuffers).toBe(true);
    expect(tree.executionTime).toBe(321.0);
    expect(tree.planningTime).toBe(0.42);

    const nodes = flatten(tree.root);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id)).toEqual([0, 1]); // pre-order ids
    const seq = nodes[1];
    expect(seq?.relationName).toBe("orders");
    expect(seq?.rowsRemovedByFilter).toBe(4500000);
  });

  it("detects cost-only plans", () => {
    const [tree] = parseExplainJson(
      '[{"Plan":{"Node Type":"Seq Scan","Relation Name":"t","Plan Rows":10,"Total Cost":5}}]',
    );
    expect(tree?.hasAnalyze).toBe(false);
    expect(tree?.hasBuffers).toBe(false);
  });

  it("captures workers, WAL, and serialization time", () => {
    const [tree] = parseExplainJson(
      JSON.stringify([
        {
          Plan: {
            "Node Type": "Gather",
            "Plan Rows": 1,
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Workers Launched": 1,
            Plans: [
              {
                "Node Type": "Seq Scan",
                "Relation Name": "t",
                "Plan Rows": 1,
                "Actual Rows": 1,
                "Actual Loops": 1,
                "WAL Records": 3,
                "WAL Bytes": 200,
                "WAL FPI": 1,
                Workers: [
                  {
                    "Worker Number": 0,
                    "Actual Rows": 5,
                    "Actual Loops": 1,
                    "Actual Total Time": 2.5,
                  },
                ],
              },
            ],
          },
          "Execution Time": 10,
          Serialization: { Time: 1.5 },
        },
      ]),
    );
    expect(tree?.serializationTime).toBe(1.5);
    const scan = tree?.root.children[0];
    expect(scan?.walRecords).toBe(3);
    expect(scan?.workers?.[0]?.actualTotalTime).toBe(2.5);
  });

  it("accepts a bare plan node and a bare statement object", () => {
    expect(parseExplainJson('{"Node Type":"Result","Plan Rows":1}')).toHaveLength(1);
    expect(parseExplainJson('{"Plan":{"Node Type":"Result","Plan Rows":1}}')).toHaveLength(1);
  });

  it("throws PGX_MALFORMED_JSON with a location for bad JSON", () => {
    try {
      parseExplainJson("[{not json}]");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.diagnostic.code).toBe("PGX_MALFORMED_JSON");
      expect(e.diagnostic.location?.kind).toBe("input");
    }
  });

  it("throws PGX_UNEXPECTED_PLAN_SHAPE for valid-but-wrong JSON", () => {
    try {
      parseExplainJson('{"rows":[1,2,3]}');
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as AppError).diagnostic.code).toBe("PGX_UNEXPECTED_PLAN_SHAPE");
    }
  });
});
