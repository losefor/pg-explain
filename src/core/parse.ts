import { opError } from "../diagnostics/catalog.ts";
import type { JitInfo, PlanNode, PlanTree, RawPlan, TriggerInfo } from "./model.ts";
import { parseTextToStatements } from "./parse-text.ts";
import { ExplainOutputSchema } from "./schema.ts";

// ── safe field readers ────────────────────────────────────────────────────────

function num(raw: RawPlan, key: string): number | undefined {
  const v = raw[key];
  return typeof v === "number" ? v : undefined;
}

function str(raw: RawPlan, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" ? v : undefined;
}

function strArray(raw: RawPlan, key: string): string[] | undefined {
  const v = raw[key];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  if (typeof v === "string") return [v];
  return undefined;
}

// ── JSON parse with line/column for actionable malformed-input errors ─────────

function parseJsonWithLocation(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let line: number | undefined;
    let col: number | undefined;

    const lc = message.match(/line (\d+) column (\d+)/i);
    if (lc?.[1] && lc[2]) {
      line = Number(lc[1]);
      col = Number(lc[2]);
    } else {
      const pos = message.match(/position (\d+)/i);
      if (pos?.[1]) {
        const offset = Number(pos[1]);
        const before = input.slice(0, offset);
        line = before.split("\n").length;
        col = offset - before.lastIndexOf("\n");
      }
    }

    const where = line && col ? ` (line ${line}, col ${col})` : "";
    throw opError(
      "PGX_MALFORMED_JSON",
      {
        detail: `The plan input could not be parsed as JSON${where}: ${message}`,
        location: line && col ? { kind: "input", line, col } : { kind: "input" },
      },
      err,
    );
  }
}

// ── normalization ─────────────────────────────────────────────────────────────

function normalizeNode(raw: RawPlan, nextId: () => number): PlanNode {
  const node: PlanNode = {
    id: nextId(),
    nodeType: raw["Node Type"],
    planRows: num(raw, "Plan Rows") ?? 0,
    children: [],
    metrics: {},
    raw,
  };

  assign(node, {
    parentRelationship: str(raw, "Parent Relationship"),
    subplanName: str(raw, "Subplan Name"),
    relationName: str(raw, "Relation Name"),
    schema: str(raw, "Schema"),
    alias: str(raw, "Alias"),
    indexName: str(raw, "Index Name"),
    planWidth: num(raw, "Plan Width"),
    startupCost: num(raw, "Startup Cost"),
    totalCost: num(raw, "Total Cost"),
    actualRows: num(raw, "Actual Rows"),
    actualLoops: num(raw, "Actual Loops"),
    actualStartupTime: num(raw, "Actual Startup Time"),
    actualTotalTime: num(raw, "Actual Total Time"),
    filter: str(raw, "Filter"),
    rowsRemovedByFilter: num(raw, "Rows Removed by Filter"),
    indexCond: str(raw, "Index Cond"),
    recheckCond: str(raw, "Recheck Cond"),
    rowsRemovedByIndexRecheck: num(raw, "Rows Removed by Index Recheck"),
    heapFetches: num(raw, "Heap Fetches"),
    hashCond: str(raw, "Hash Cond"),
    joinType: str(raw, "Join Type"),
    joinFilter: str(raw, "Join Filter"),
    rowsRemovedByJoinFilter: num(raw, "Rows Removed by Join Filter"),
    output: strArray(raw, "Output"),
    sortMethod: str(raw, "Sort Method"),
    sortSpaceType: str(raw, "Sort Space Type"),
    sortSpaceUsed: num(raw, "Sort Space Used"),
    sortKey: strArray(raw, "Sort Key"),
    hashBuckets: num(raw, "Hash Buckets"),
    originalHashBuckets: num(raw, "Original Hash Buckets"),
    hashBatches: num(raw, "Hash Batches"),
    originalHashBatches: num(raw, "Original Hash Batches"),
    peakMemoryUsage: num(raw, "Peak Memory Usage"),
    diskUsage: num(raw, "Disk Usage"),
    exactHeapBlocks: num(raw, "Exact Heap Blocks"),
    lossyHeapBlocks: num(raw, "Lossy Heap Blocks"),
    sharedHitBlocks: num(raw, "Shared Hit Blocks"),
    sharedReadBlocks: num(raw, "Shared Read Blocks"),
    sharedDirtiedBlocks: num(raw, "Shared Dirtied Blocks"),
    sharedWrittenBlocks: num(raw, "Shared Written Blocks"),
    localHitBlocks: num(raw, "Local Hit Blocks"),
    localReadBlocks: num(raw, "Local Read Blocks"),
    tempReadBlocks: num(raw, "Temp Read Blocks"),
    tempWrittenBlocks: num(raw, "Temp Written Blocks"),
    ioReadTime: num(raw, "I/O Read Time"),
    ioWriteTime: num(raw, "I/O Write Time"),
    workersPlanned: num(raw, "Workers Planned"),
    workersLaunched: num(raw, "Workers Launched"),
  });

  const childPlans = raw.Plans;
  if (Array.isArray(childPlans)) {
    for (const child of childPlans) {
      node.children.push(normalizeNode(child, nextId));
    }
  }
  return node;
}

/** Copy only the defined keys, so optional fields stay absent (not `undefined`). */
function assign<T extends object>(target: T, fields: Partial<T>): void {
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
}

function parseTriggers(raw: unknown): TriggerInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const r = t as RawPlan;
    const info: TriggerInfo = {};
    assign(info, {
      name: str(r, "Trigger Name"),
      constraintName: str(r, "Constraint Name"),
      relation: str(r, "Relation"),
      calls: num(r, "Calls"),
      time: num(r, "Time"),
    });
    return info;
  });
}

function parseJit(raw: unknown): JitInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as RawPlan;
  const timing = r.Timing as RawPlan | undefined;
  const jit: JitInfo = {};
  const functions = num(r, "Functions");
  if (functions !== undefined) jit.functions = functions;
  if (timing && typeof timing === "object") {
    jit.timing = {
      total: num(timing, "Total"),
      generation: num(timing, "Generation"),
      inlining: num(timing, "Inlining"),
      optimization: num(timing, "Optimization"),
      emission: num(timing, "Emission"),
    };
  }
  return jit;
}

/** One EXPLAIN statement, before normalization — the JSON `[{ "Plan": … }]` shape. */
export interface RawStatement {
  Plan: RawPlan;
  "Planning Time"?: number;
  "Execution Time"?: number;
  Triggers?: unknown;
  JIT?: unknown;
  Settings?: unknown;
  [key: string]: unknown;
}

/** Build a normalized PlanTree from one statement object (JSON- or text-parsed). */
export function statementToTree(stmt: RawStatement): PlanTree {
  let id = 0;
  const root = normalizeNode(stmt.Plan, () => id++);
  const hasAnalyze = root.actualLoops !== undefined || stmt["Execution Time"] !== undefined;
  const hasBuffers = root.sharedHitBlocks !== undefined || root.sharedReadBlocks !== undefined;

  const tree: PlanTree = {
    root,
    triggers: parseTriggers(stmt.Triggers),
    hasAnalyze,
    hasBuffers,
    raw: stmt.Plan,
  };
  if (typeof stmt["Planning Time"] === "number") tree.planningTime = stmt["Planning Time"];
  if (typeof stmt["Execution Time"] === "number") tree.executionTime = stmt["Execution Time"];
  const jit = parseJit(stmt.JIT);
  if (jit) tree.jit = jit;
  if (stmt.Settings) tree.settings = stmt.Settings as Record<string, string>;
  return tree;
}

/**
 * Parse EXPLAIN input into one PlanTree per statement, auto-detecting the format:
 * JSON (`[`/`{`) → parseExplainJson, otherwise plain-text `EXPLAIN` output.
 */
export function parseExplain(input: string): PlanTree[] {
  return /^\s*[[{]/.test(input) ? parseExplainJson(input) : parseExplainText(input);
}

/** Parse plain-text `EXPLAIN [ANALYZE]` output (psql/pgAdmin) into PlanTrees. */
export function parseExplainText(input: string): PlanTree[] {
  return parseTextToStatements(input).map(statementToTree);
}

/**
 * Parse EXPLAIN (FORMAT JSON) text into one PlanTree per statement.
 * Accepts the standard `[{ "Plan": … }]`, a bare statement object, or a bare plan node.
 * Throws AppError(PGX_MALFORMED_JSON | PGX_UNEXPECTED_PLAN_SHAPE) with a location.
 */
export function parseExplainJson(input: string): PlanTree[] {
  const json = parseJsonWithLocation(input);

  // Normalize the accepted shapes into the canonical array-of-statements.
  let candidate: unknown = json;
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    candidate = "Plan" in obj ? [obj] : "Node Type" in obj ? [{ Plan: obj }] : json;
  }

  const result = ExplainOutputSchema.safeParse(candidate);
  if (!result.success) {
    throw opError("PGX_UNEXPECTED_PLAN_SHAPE", {
      detail: `The JSON is valid but is not an EXPLAIN plan: ${result.error.issues[0]?.message ?? "missing 'Plan' node"}.`,
      location: { kind: "input" },
    });
  }

  return result.data.map((stmt) => statementToTree(stmt as unknown as RawStatement));
}

/** Depth-first pre-order walk (root first). Used by metrics and the advisor. */
export function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** Flatten a tree to an array in pre-order. */
export function flatten(node: PlanNode): PlanNode[] {
  const out: PlanNode[] = [];
  walk(node, (n) => out.push(n));
  return out;
}
