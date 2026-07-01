export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  code: string;
  domain: string;
  severity: Severity;
  title: string;
  detail: string;
  cause: string;
  remediation: { summary: string; steps?: string[]; commands?: { label?: string; sql?: string; shell?: string }[] };
  docsUrl?: string;
  location?: { relation?: string; nodeType?: string };
}

export interface NodeMetrics {
  totalRows?: number;
  inclusiveMs?: number;
  selfMs?: number;
  pctOfTotal?: number;
  estimateFactor?: number;
  estimateDirection?: "over" | "under" | "accurate";
  cacheHitRatio?: number | null;
  filterDiscardRatio?: number;
  lossyRatio?: number;
}

export interface WorkerStat {
  number: number;
  actualRows?: number;
  actualLoops?: number;
  actualStartupTime?: number;
  actualTotalTime?: number;
}

export interface PlanNode {
  id: number;
  nodeType: string;
  parentRelationship?: string;
  subplanName?: string;
  relationName?: string;
  schema?: string;
  alias?: string;
  indexName?: string;
  planRows: number;
  planWidth?: number;
  startupCost?: number;
  totalCost?: number;
  actualRows?: number;
  actualLoops?: number;
  actualStartupTime?: number;
  actualTotalTime?: number;
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
  output?: string[];
  sortMethod?: string;
  sortSpaceType?: string;
  sortSpaceUsed?: number;
  sortKey?: string[];
  hashBuckets?: number;
  hashBatches?: number;
  peakMemoryUsage?: number;
  diskUsage?: number;
  exactHeapBlocks?: number;
  lossyHeapBlocks?: number;
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
  workersPlanned?: number;
  workersLaunched?: number;
  workers?: WorkerStat[];
  walRecords?: number;
  walBytes?: number;
  walFpi?: number;
  metrics: NodeMetrics;
  children: PlanNode[];
}

export interface TriggerInfo {
  name?: string;
  relation?: string;
  calls?: number;
  time?: number;
}
export interface JitInfo {
  functions?: number;
  timing?: { total?: number; generation?: number; inlining?: number; optimization?: number; emission?: number };
}

export interface StatGroup {
  key: string;
  count: number;
  selfMs: number;
  pctOfTotal: number;
}
export interface PlanStats {
  byNodeType: StatGroup[];
  byRelation: StatGroup[];
  byIndex: StatGroup[];
}

export interface Report {
  schemaVersion: number;
  verdict: string;
  worstSeverity: Severity | null;
  summary: { planningTimeMs: number | null; executionTimeMs: number | null; serializationTimeMs?: number | null; hasAnalyze: boolean; hasBuffers: boolean; nodeCount: number; findings: Record<Severity, number> };
  diagnostics: Diagnostic[];
  bottlenecks: { id: number; label: string; selfMs: number | null; pctOfTotal: number | null }[];
  stats?: PlanStats;
  triggers?: TriggerInfo[];
  jit?: JitInfo | null;
  settings?: Record<string, string> | null;
  plan: PlanNode;
  server?: { major: number; omitted: string[] };
  runId?: string;
}

export interface RunSummary {
  id: string;
  createdAt: number;
  kind: "analyze" | "run";
  verdict: string;
  worstSeverity: Severity | null;
  execMs: number | null;
  counts: Record<Severity, number>;
  starred: boolean;
}

export interface LiveLockSession {
  pid: number;
  user: string | null;
  state: string | null;
  waitEvent: string | null;
  ageSeconds: number | null;
  query: string | null;
  blockedBy: number[];
}
export interface LiveLocks {
  sessions: LiveLockSession[];
  blocked: LiveLockSession[];
  capturedAt: number;
}

export interface SigDelta {
  signature: string;
  beforeMs: number;
  afterMs: number;
  deltaMs: number;
  deltaPct: number | null;
}
export interface DiffResult {
  beforeMs?: number;
  afterMs?: number;
  execDeltaMs?: number;
  execDeltaPct?: number;
  regressed: SigDelta[];
  improved: SigDelta[];
  added: SigDelta[];
  removed: SigDelta[];
  newFindings: Diagnostic[];
  resolvedFindings: Diagnostic[];
}

export interface ScriptUnit {
  label: string;
  status: "analyzed" | "skipped" | "error";
  loopNote: string | null;
  report: Report | null;
  reason: string | null;
  errorCode: string | null;
}
export interface ScriptAnalysis {
  executed: false;
  serverMajor: number | null;
  units: ScriptUnit[];
}

export interface RelationStat {
  relation: string;
  estRows: number | null;
  totalBytes: number | null;
  indexes: string[];
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

export interface ConnectionPublic {
  id: string;
  name: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: string;
  hasPassword: boolean;
}

export interface Settings {
  thresholds: Record<string, number>;
  rules: Record<string, { enabled?: boolean; severity?: Severity }>;
}

export interface ApiError {
  code: string;
  title: string;
  detail?: string;
  remediation?: { summary?: string };
  /** Present on query errors: 1-based char offset of the problem in the SQL. */
  meta?: { position?: number; [k: string]: unknown };
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: string[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw (json.error ?? { code: "PGX_ERROR", title: `Request failed (${res.status})` }) as ApiError;
  return json as T;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  meta: () => call<{ version: string; node: string }>("/api/meta"),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (body: Partial<Settings>) => call<Settings>("/api/settings", { ...jsonInit(body), method: "PUT" }),
  analyze: (plan: string, sql?: string) => call<Report>("/api/analyze", jsonInit({ plan, sql })),
  run: (body: { connection?: Record<string, unknown>; connectionId?: string; sql: string }) => call<Report>("/api/run", jsonInit(body)),
  analyzeSql: (body: { connection?: Record<string, unknown>; connectionId?: string; sql: string }) => call<ScriptAnalysis>("/api/analyze-sql", jsonInit(body)),
  schema: (body: { connection?: Record<string, unknown>; connectionId?: string; relations: string[] }) =>
    call<{ relations: RelationStat[] }>("/api/schema", jsonInit(body)),
  catalog: (body: { connection?: Record<string, unknown>; connectionId?: string }) =>
    call<{ tables: TableInfo[] }>("/api/catalog", jsonInit(body)),
  connections: () => call<{ connections: ConnectionPublic[] }>("/api/connections"),
  createConnection: (body: Record<string, unknown>) => call<ConnectionPublic>("/api/connections", jsonInit(body)),
  deleteConnection: (id: string) => call(`/api/connections/${id}`, { method: "DELETE" }),
  history: () => call<{ runs: RunSummary[] }>("/api/history"),
  getRun: (id: string) => call<RunSummary & { report: Report }>(`/api/history/${id}`),
  deleteRun: (id: string) => call(`/api/history/${id}`, { method: "DELETE" }),
  liveLocks: (body: { connection?: Record<string, unknown>; connectionId?: string }) => call<LiveLocks>("/api/locks/live", jsonInit(body)),
  diff: (beforeId: string, afterId: string) => call<DiffResult>("/api/diff", jsonInit({ beforeId, afterId })),
  export: async (runId: string, format: "markdown" | "html" | "text"): Promise<string> => {
    const res = await fetch("/api/export", jsonInit({ runId, format }));
    if (!res.ok) throw ((await res.json().catch(() => ({}))).error ?? { code: "PGX_ERROR", title: "Export failed" }) as ApiError;
    return res.text();
  },
};

