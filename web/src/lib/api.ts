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

export interface PlanNode {
  id: number;
  nodeType: string;
  relationName?: string;
  indexName?: string;
  alias?: string;
  metrics: { totalRows?: number; selfMs?: number; pctOfTotal?: number; estimateFactor?: number; estimateDirection?: string; cacheHitRatio?: number | null };
  children: PlanNode[];
}

export interface Report {
  schemaVersion: number;
  verdict: string;
  worstSeverity: Severity | null;
  summary: { planningTimeMs: number | null; executionTimeMs: number | null; hasAnalyze: boolean; hasBuffers: boolean; nodeCount: number; findings: Record<Severity, number> };
  diagnostics: Diagnostic[];
  bottlenecks: { id: number; label: string; selfMs: number | null; pctOfTotal: number | null }[];
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

