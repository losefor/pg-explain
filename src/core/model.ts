/**
 * Domain model for pg-explain.
 *
 * Two things flow through the whole program:
 *  - PlanTree / PlanNode  — the normalized EXPLAIN plan.
 *  - Diagnostic           — a single actionable message. The SAME shape is used for
 *                           operational tool errors and for plan-analysis findings, so
 *                           one renderer serves both and `--format json` exposes both
 *                           with identical, machine-readable actionability.
 */

export type Severity = "error" | "warn" | "info";
export type Domain = "operational" | "plan";

/** A copy-pasteable, credential-free command shown to the user. */
export interface RemediationCommand {
  label?: string;
  /** A shell command, e.g. `pg_isready -h <host> -p <port>`. */
  shell?: string;
  /** A SQL statement, e.g. `GRANT SELECT ON orders TO readonly;`. */
  sql?: string;
}

/** HOW to fix it. Mandatory on every Diagnostic; `summary` is never empty. */
export interface Remediation {
  summary: string;
  steps?: string[];
  commands?: RemediationCommand[];
}

export interface DiagnosticLocation {
  kind: "node" | "connection" | "input" | "option";
  /** Pre-order id assigned during parse, for `node` locations. */
  nodeId?: number;
  nodeType?: string;
  relation?: string;
  /** 1-based line/col for `input` (malformed JSON) locations. */
  line?: number;
  col?: number;
  optionName?: string;
}

/**
 * The load-bearing type. Every error and every finding is one of these, and every
 * one carries a non-empty `remediation` so the developer always knows what to do next.
 */
export interface Diagnostic {
  /** Stable, greppable identifier, e.g. PGX_AUTH_FAILED, PGX_SEQ_SCAN_LARGE. */
  code: string;
  domain: Domain;
  severity: Severity;
  /** One scannable headline line, no trailing punctuation. */
  title: string;
  /** WHAT happened, in plain language. */
  detail: string;
  /** WHY it happened / why it matters. */
  cause: string;
  remediation: Remediation;
  /** Deep link with an anchor to the authoritative PostgreSQL doc. */
  docsUrl?: string;
  location?: DiagnosticLocation;
  /** Structured extras for machine consumers (timeoutMs, pgVersion, sqlState, …). */
  meta?: Record<string, string | number>;
}

// ── Plan model ──────────────────────────────────────────────────────────────

/** The original EXPLAIN FORMAT JSON node, untouched. Escape hatch for rare fields. */
export interface RawPlan {
  "Node Type": string;
  Plans?: RawPlan[];
  [key: string]: unknown;
}

/** Derived per-node metrics, all per-loop-corrected. Absent without ANALYZE. */
export interface NodeMetrics {
  /** "Actual Rows" × "Actual Loops" — the true total this node produced. */
  totalRows?: number;
  /** "Actual Total Time" × "Actual Loops" — wall time of this subtree, all loops. */
  inclusiveMs?: number;
  /** inclusive − Σ(children inclusive), clamped ≥ 0. The bottleneck-ranking quantity. */
  selfMs?: number;
  /** 100 × selfMs / execution time. */
  pctOfTotal?: number;
  /** Misestimate factor ≥ 1 (max(est,act)/min(est,act)). */
  estimateFactor?: number;
  estimateDirection?: "over" | "under" | "accurate";
  /** shared hit / (hit + read); null when no shared-buffer access here. */
  cacheHitRatio?: number | null;
  /** rows removed / (removed + kept). */
  filterDiscardRatio?: number;
  /** lossy / (lossy + exact). */
  lossyRatio?: number;
}

export interface PlanNode {
  /** Pre-order index assigned at parse time; stable id for locations/diff. */
  id: number;
  nodeType: string;
  parentRelationship?: string;
  subplanName?: string;
  relationName?: string;
  schema?: string;
  alias?: string;
  indexName?: string;

  // Estimates (always present, even cost-only).
  planRows: number;
  planWidth?: number;
  startupCost?: number;
  totalCost?: number;

  // Actuals — per loop, as reported by Postgres. Absent without ANALYZE.
  actualRows?: number;
  actualLoops?: number;
  actualStartupTime?: number;
  actualTotalTime?: number;

  // Predicates / filters.
  filter?: string;
  rowsRemovedByFilter?: number;
  indexCond?: string;
  recheckCond?: string;
  rowsRemovedByIndexRecheck?: number;
  heapFetches?: number;
  hashCond?: string;
  joinType?: string;
  joinFilter?: string;
  rowsRemovedByJoinFilter?: number;
  /** Projected columns (VERBOSE only). */
  output?: string[];

  // Sort.
  sortMethod?: string;
  sortSpaceType?: string;
  sortSpaceUsed?: number;
  sortKey?: string[];

  // Hash.
  hashBuckets?: number;
  originalHashBuckets?: number;
  hashBatches?: number;
  originalHashBatches?: number;
  peakMemoryUsage?: number;
  diskUsage?: number;

  // Bitmap heap.
  exactHeapBlocks?: number;
  lossyHeapBlocks?: number;

  // Memoize (ANALYZE only).
  cacheHits?: number;
  cacheMisses?: number;
  cacheEvictions?: number;
  cacheOverflows?: number;

  // Buffers (cumulative across loops — do NOT multiply by loops).
  sharedHitBlocks?: number;
  sharedReadBlocks?: number;
  sharedDirtiedBlocks?: number;
  sharedWrittenBlocks?: number;
  localHitBlocks?: number;
  localReadBlocks?: number;
  tempReadBlocks?: number;
  tempWrittenBlocks?: number;
  ioReadTime?: number;
  ioWriteTime?: number;

  // Parallelism.
  workersPlanned?: number;
  workersLaunched?: number;
  /** Per-worker actuals (EXPLAIN ANALYZE VERBOSE). */
  workers?: WorkerStat[];

  // WAL (data-modifying statements analyzed with the WAL option).
  walRecords?: number;
  walBytes?: number;
  walFpi?: number;

  children: PlanNode[];
  metrics: NodeMetrics;
  /** Original JSON node — rules may read rare fields not normalized above. */
  raw: RawPlan;
}

export interface WorkerStat {
  number: number;
  actualRows?: number;
  actualLoops?: number;
  actualStartupTime?: number;
  actualTotalTime?: number;
}

export interface JitInfo {
  functions?: number;
  timing?: {
    total?: number;
    generation?: number;
    inlining?: number;
    optimization?: number;
    emission?: number;
  };
}

export interface TriggerInfo {
  name?: string;
  constraintName?: string;
  relation?: string;
  calls?: number;
  time?: number;
}

export interface PlanTree {
  root: PlanNode;
  planningTime?: number;
  executionTime?: number;
  /** Result-serialization time in ms (PG17+ EXPLAIN ANALYZE SERIALIZE). */
  serializationTime?: number;
  triggers: TriggerInfo[];
  jit?: JitInfo;
  settings?: Record<string, string>;
  /** Actual row/time data present (EXPLAIN ANALYZE was used). */
  hasAnalyze: boolean;
  /** Buffer counters present (BUFFERS was used). */
  hasBuffers: boolean;
  raw: RawPlan;
}

// ── Advisor ─────────────────────────────────────────────────────────────────

export interface Thresholds {
  seqScanRows: number;
  nestedLoopOuterRows: number;
  filterDiscardRatio: number;
  filterRemovedAbs: number;
  misestimateFactor: number;
  heapFetchRatio: number;
  heapFetchAbs: number;
  correlatedLoops: number;
  jitPct: number;
  triggerPct: number;
  lowCacheHitRatio: number;
  limitDiscardRows: number;
  staleStatsModRatio: number;
}

export interface AnalysisContext {
  tree: PlanTree;
  thresholds: Thresholds;
  /** Resolve a rule's severity, honoring config overrides. */
  severityOf(ruleId: string, fallback: Severity): Severity;
  /** Whether a rule is enabled (config can disable rules). */
  isEnabled(ruleId: string): boolean;
}

/**
 * One anti-pattern rule. `check` is called once per node in the tree; tree-level
 * rules (JIT, triggers) act only when `node === ctx.tree.root`.
 */
export interface Rule {
  id: string;
  title: string;
  defaultSeverity: Severity;
  requiresAnalyze?: boolean;
  requiresBuffers?: boolean;
  check(node: PlanNode, ctx: AnalysisContext): Diagnostic[];
}

export interface AnalysisResult {
  tree: PlanTree;
  /** Plan-domain findings, sorted by severity then impact. */
  diagnostics: Diagnostic[];
  /** Top nodes by self time. */
  bottlenecks: PlanNode[];
  /** One-line verdict shown at the top of every report. */
  verdict: string;
  /** Highest severity present, or null if clean. */
  worstSeverity: Severity | null;
}
