import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../../src/core/metrics.ts";
import type { PlanNode } from "../../../src/core/model.ts";
import { flatten, parseExplain, parseExplainText } from "../../../src/core/parse.ts";

/** Parse text → compute metrics → return the single tree. */
function tree(text: string) {
  const [t] = parseExplainText(text);
  if (!t) throw new Error("no tree parsed");
  computeMetrics(t);
  return t;
}

describe("parseExplainText", () => {
  it("parses a nested-loop plan with ANALYZE + BUFFERS", () => {
    const t = tree(
      [
        "Nested Loop  (cost=0.29..16.32 rows=1 width=64) (actual time=0.045..0.052 rows=1 loops=1)",
        "  Buffers: shared hit=8",
        "  ->  Seq Scan on orders  (cost=0.00..8.00 rows=1 width=32) (actual time=0.020..0.025 rows=1 loops=1)",
        "        Filter: (id = 42)",
        "        Rows Removed by Filter: 99",
        "        Buffers: shared hit=4 read=2",
        "  ->  Index Scan using customers_pkey on customers  (cost=0.29..8.30 rows=1 width=32) (actual time=0.015..0.018 rows=1 loops=1)",
        "        Index Cond: (id = orders.customer_id)",
        "  Buffers: shared hit=4",
        "Planning Time: 0.123 ms",
        "Execution Time: 0.210 ms",
      ].join("\n"),
    );

    expect(t.root.nodeType).toBe("Nested Loop");
    expect(t.hasAnalyze).toBe(true);
    expect(t.hasBuffers).toBe(true);
    expect(t.planningTime).toBe(0.123);
    expect(t.executionTime).toBe(0.21);

    const nodes = flatten(t.root);
    expect(nodes.map((n) => n.nodeType)).toEqual(["Nested Loop", "Seq Scan", "Index Scan"]);
    expect(nodes.map((n) => n.id)).toEqual([0, 1, 2]); // pre-order ids

    const seq = nodes[1] as PlanNode;
    expect(seq.relationName).toBe("orders");
    expect(seq.filter).toBe("(id = 42)");
    expect(seq.rowsRemovedByFilter).toBe(99);
    expect(seq.sharedHitBlocks).toBe(4);
    expect(seq.sharedReadBlocks).toBe(2);

    const idx = nodes[2] as PlanNode;
    expect(idx.indexName).toBe("customers_pkey");
    expect(idx.relationName).toBe("customers");
    expect(idx.indexCond).toBe("(id = orders.customer_id)");
  });

  it("produces the same normalized tree as the JSON twin", () => {
    const text = [
      "Seq Scan on t  (cost=0.00..1.10 rows=10 width=4) (actual time=0.500..0.800 rows=9 loops=1)",
      "  Filter: (x > 5)",
      "  Rows Removed by Filter: 1",
      "Execution Time: 1.000 ms",
    ].join("\n");
    const json = JSON.stringify([
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "t",
          "Startup Cost": 0.0,
          "Total Cost": 1.1,
          "Plan Rows": 10,
          "Plan Width": 4,
          "Actual Startup Time": 0.5,
          "Actual Total Time": 0.8,
          "Actual Rows": 9,
          "Actual Loops": 1,
          Filter: "(x > 5)",
          "Rows Removed by Filter": 1,
        },
        "Execution Time": 1.0,
      },
    ]);

    const fromText = tree(text);
    const [fromJson] = parseExplain(json);
    if (!fromJson) throw new Error("no json tree");
    computeMetrics(fromJson);

    const shape = (n: PlanNode) => ({
      nodeType: n.nodeType,
      relationName: n.relationName,
      planRows: n.planRows,
      actualRows: n.actualRows,
      actualLoops: n.actualLoops,
      totalCost: n.totalCost,
      filter: n.filter,
      rowsRemovedByFilter: n.rowsRemovedByFilter,
      totalRows: n.metrics.totalRows,
      selfMs: n.metrics.selfMs,
    });
    expect(shape(fromText.root)).toEqual(shape(fromJson.root));
    expect(fromText.executionTime).toBe(fromJson.executionTime);
    expect(fromText.hasAnalyze).toBe(fromJson.hasAnalyze);
  });

  it("marks never-executed nodes (loops=0)", () => {
    const t = tree(
      [
        "Append  (cost=0.00..2.00 rows=2 width=4) (actual time=0.01..0.02 rows=1 loops=1)",
        "  ->  Index Scan using idx on t  (cost=0.29..8.30 rows=1 width=4) (never executed)",
      ].join("\n"),
    );
    const idx = flatten(t.root)[1] as PlanNode;
    expect(idx.actualLoops).toBe(0);
    expect(idx.actualRows).toBe(0);
  });

  it("strips the Parallel prefix and captures workers", () => {
    const t = tree(
      [
        "Gather  (cost=1000.00..2000.00 rows=100 width=4) (actual time=1.0..5.0 rows=100 loops=1)",
        "  Workers Planned: 2",
        "  Workers Launched: 2",
        "  ->  Parallel Seq Scan on big  (cost=0.00..900.00 rows=42 width=4) (actual time=0.5..3.0 rows=33 loops=3)",
        "        Worker 0:  actual time=0.4..2.9 rows=30 loops=1",
        "        Worker 1:  actual time=0.6..3.1 rows=36 loops=1",
      ].join("\n"),
    );
    expect(t.root.nodeType).toBe("Gather");
    expect(t.root.workersPlanned).toBe(2);
    expect(t.root.workersLaunched).toBe(2);

    const scan = flatten(t.root)[1] as PlanNode;
    expect(scan.nodeType).toBe("Seq Scan"); // "Parallel " stripped to match JSON
    expect(scan.relationName).toBe("big");
    expect(Array.isArray(scan.raw.Workers)).toBe(true);
    expect((scan.raw.Workers as unknown[]).length).toBe(2);
  });

  it("attaches a CTE subtree with the InitPlan relationship", () => {
    const t = tree(
      [
        "Aggregate  (cost=0.00..1.00 rows=1 width=8) (actual time=0.10..0.11 rows=1 loops=1)",
        "  CTE cte1",
        "    ->  Seq Scan on base  (cost=0.00..0.50 rows=5 width=4) (actual time=0.01..0.02 rows=5 loops=1)",
        "  ->  CTE Scan on cte1  (cost=0.00..0.50 rows=5 width=4) (actual time=0.03..0.04 rows=5 loops=1)",
      ].join("\n"),
    );
    const nodes = flatten(t.root);
    const base = nodes.find((n) => n.relationName === "base") as PlanNode;
    expect(base.parentRelationship).toBe("InitPlan");
    expect(base.subplanName).toBe("CTE cte1");
    expect(nodes.some((n) => n.nodeType === "CTE Scan")).toBe(true);
  });

  it("auto-detects text vs JSON via parseExplain", () => {
    const [textTree] = parseExplain("Result  (cost=0.00..0.01 rows=1 width=4)");
    expect(textTree?.root.nodeType).toBe("Result");
    const [jsonTree] = parseExplain('[{"Plan":{"Node Type":"Result","Plan Rows":1}}]');
    expect(jsonTree?.root.nodeType).toBe("Result");
  });

  it("splits multiple statements on blank lines", () => {
    const trees = parseExplainText(
      [
        "Seq Scan on a  (cost=0.00..1.00 rows=1 width=4)",
        "",
        "Seq Scan on b  (cost=0.00..1.00 rows=1 width=4)",
      ].join("\n"),
    );
    expect(trees).toHaveLength(2);
    expect(trees[0]?.root.relationName).toBe("a");
    expect(trees[1]?.root.relationName).toBe("b");
  });
});
