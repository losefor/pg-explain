import { Check, CheckCircle2, ChevronDown, ChevronRight, CornerDownRight, ExternalLink, Lock, Minus, Plus, Settings as SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format as formatSqlText } from "sql-formatter";
import { CodeEditor, type CodeEditorHandle } from "./components/CodeEditor.tsx";
import { NodeDetail } from "./components/NodeDetail.tsx";
import { api, type ApiError, type ConnectionPublic, type Diagnostic, type DiffResult, type LiveLocks, type PlanNode, type PlanStats, type RelationStat, type Report, type RunSummary, type ScriptAnalysis, type Settings, type Severity, type SigDelta, type StatGroup, type TableInfo } from "./lib/api.ts";

/** True when the SQL isn't a single plain SELECT — a DO block, multi-statement, or a write. */
function isScripty(sql: string): boolean {
  const s = sql.trim();
  if (/^do\b/i.test(s)) return true;
  if (/;\s*\S/.test(s.replace(/;\s*$/, ""))) return true; // more than one statement
  return !/^(select|with|table|values|explain)\b/i.test(s);
}

function collectRelations(node: PlanNode, acc = new Set<string>()): string[] {
  if (node.relationName) acc.add(node.relationName);
  for (const c of node.children) collectRelations(c, acc);
  return [...acc];
}

function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}

const SEV_COLOR: Record<Severity, string> = {
  error: "var(--sev-error)",
  warn: "var(--sev-warn)",
  info: "var(--sev-info)",
};
const SEV_LABEL: Record<Severity, string> = { error: "Critical", warn: "Warning", info: "Note" };

const isLock = (code: string) => /^PGX_(LOCK|DDL|WRITE|DROP_INDEX|SELECT_FOR|UPDATE_UNINDEXED)/.test(code);

export function App() {
  const [mode, setMode] = useState<"run" | "paste">("run");
  const [sql, setSql] = useState("select * from pg_class limit 50");
  const [plan, setPlan] = useState("");
  const [conn, setConn] = useState({ host: "", port: "", database: "", user: "", password: "" });
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [live, setLive] = useState<LiveLocks | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [script, setScript] = useState<ScriptAnalysis | null>(null);
  const [connections, setConnections] = useState<ConnectionPublic[]>([]);
  const [connId, setConnId] = useState("");
  const [tableStats, setTableStats] = useState<RelationStat[]>([]);
  const [catalog, setCatalog] = useState<TableInfo[]>([]);
  const [editorError, setEditorError] = useState<{ offset: number; message: string } | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

  // lang-sql autocomplete map: bare name + schema-qualified name → columns.
  const schemaMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const t of catalog) {
      m[t.name] = t.columns;
      m[`${t.schema}.${t.name}`] = t.columns;
    }
    return m;
  }, [catalog]);

  const formatSql = () => {
    try {
      setSql(formatSqlText(sql, { language: "postgresql" }));
    } catch {
      /* leave malformed SQL untouched */
    }
  };

  const refreshHistory = useCallback(() => {
    api.history().then((r) => setHistory(r.runs)).catch(() => {});
  }, []);
  const refreshConnections = useCallback(() => {
    api.connections().then((r) => setConnections(r.connections)).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory]);
  useEffect(refreshConnections, [refreshConnections]);

  // Load the table/column catalog for autocomplete + the explorer when a saved connection is picked.
  // (Manual connections load lazily after the first successful run — see submit().)
  useEffect(() => {
    if (!connId) {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    api.catalog({ connectionId: connId }).then((r) => !cancelled && setCatalog(r.tables)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connId]);

  const saveConnection = async () => {
    const name = prompt("Name this connection:");
    if (!name) return;
    await api.createConnection({ name, ...cleanConn(conn) });
    refreshConnections();
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setScript(null);
    setEditorError(null);
    try {
      const connBody = connId ? { connectionId: connId } : { connection: cleanConn(conn) };

      // DO blocks, multi-statement scripts, and writes → cost-only, never executed.
      if (mode === "run" && isScripty(sql)) {
        setScript(await api.analyzeSql({ ...connBody, sql }));
        setReport(null);
        return;
      }

      const r =
        mode === "run"
          ? await api.run({ ...connBody, sql })
          : await api.analyze(plan, sql.trim() || undefined);
      setReport(r);
      setTableStats([]);
      refreshHistory();
      // Enrich a live run with table size/index/vacuum stats (same connection).
      if (mode === "run") {
        const relations = collectRelations(r.plan);
        if (relations.length) {
          api.schema({ ...connBody, relations }).then((s) => setTableStats(s.relations)).catch(() => {});
        }
        // Lazily populate autocomplete for manual connections once we know they work.
        if (!connId && catalog.length === 0) {
          api.catalog(connBody).then((res) => setCatalog(res.tables)).catch(() => {});
        }
      }
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae);
      setReport(null);
      // Underline the offending spot inline for single-statement runs that carry a pg position.
      const pos = ae.meta?.position;
      if (mode === "run" && typeof pos === "number" && pos > 0) {
        setEditorError({ offset: pos - 1, message: ae.detail || ae.title });
      }
    } finally {
      setBusy(false);
    }
  };

  const openRun = async (id: string) => {
    try {
      const r = await api.getRun(id);
      setReport({ ...r.report, runId: r.id }); // carry the id so export works after reopening
      setTableStats([]);
      setLive(null);
      setDiff(null);
      setScript(null);
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  };

  const onHistoryClick = (id: string) => {
    if (!diffMode) {
      openRun(id);
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  };

  const runDiff = async () => {
    if (picked.length !== 2) return;
    setErr(null);
    try {
      // picked is newest-first selection order; diff older → newer.
      const [a, b] = picked;
      const order = history.findIndex((h) => h.id === a) > history.findIndex((h) => h.id === b);
      setDiff(await api.diff(order ? (a as string) : (b as string), order ? (b as string) : (a as string)));
      setReport(null);
      setLive(null);
      setScript(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  };

  const checkLive = async () => {
    setBusy(true);
    setErr(null);
    try {
      setLive(await api.liveLocks(connId ? { connectionId: connId } : { connection: cleanConn(conn) }));
      setReport(null);
      setScript(null);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen grid grid-cols-[260px_1fr] overflow-hidden">
      <aside className="border-r flex flex-col min-h-0">
        <div className="px-4 py-3 border-b">
          <div className="font-semibold">pgexplain studio</div>
          <div className="text-xs text-muted-foreground">PostgreSQL EXPLAIN, locally</div>
        </div>
        <div className="px-3 py-2 flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground flex-1">History</span>
          <button
            type="button"
            onClick={() => { setDiffMode((v) => !v); setPicked([]); }}
            className={`text-xs rounded px-2 py-0.5 ${diffMode ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            Compare
          </button>
          <button
            type="button"
            title="Settings"
            onClick={async () => setSettings(await api.settings())}
            className="inline-flex items-center rounded px-2 py-1 bg-secondary"
          >
            <SettingsIcon className="size-4" />
          </button>
        </div>
        {diffMode && (
          <div className="px-3 pb-2">
            <button
              type="button"
              disabled={picked.length !== 2}
              onClick={runDiff}
              className="w-full text-xs rounded-md bg-secondary px-2 py-1 disabled:opacity-50"
            >
              Diff selected ({picked.length}/2)
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {history.length === 0 && <div className="px-2 text-sm text-muted-foreground">No runs yet.</div>}
          {history.map((h) => (
            <button
              type="button"
              key={h.id}
              onClick={() => onHistoryClick(h.id)}
              className={`w-full text-left rounded-md px-2 py-2 hover:bg-accent text-sm ${picked.includes(h.id) ? "ring-2 ring-[var(--sev-info)]" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: h.worstSeverity ? SEV_COLOR[h.worstSeverity] : "var(--sev-info)" }} />
                <span className="truncate flex-1">{h.verdict || h.kind}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {h.kind} · {h.execMs != null ? `${h.execMs.toFixed(0)} ms` : "no timing"}
              </div>
            </button>
          ))}
        </div>

        {catalog.length > 0 && (
          <div className="border-t flex flex-col min-h-0 max-h-[45%]">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              Schema · {catalog.length} tables
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {catalog.map((t) => {
                const key = `${t.schema}.${t.name}`;
                const open = openTable === key;
                return (
                  <div key={key}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setOpenTable(open ? null : key)} className="inline-flex w-4 justify-center text-muted-foreground">
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => editorRef.current?.insertText(t.name)}
                        title={`${key} — click to insert`}
                        className="flex-1 text-left rounded px-1 py-0.5 hover:bg-accent text-sm truncate"
                      >
                        {t.name}
                      </button>
                    </div>
                    {open && (
                      <div className="ml-5 border-l pl-2 space-y-0.5 py-0.5">
                        {t.columns.map((col) => (
                          <button
                            type="button"
                            key={col}
                            onClick={() => editorRef.current?.insertText(col)}
                            className="block w-full text-left rounded px-1 py-0.5 hover:bg-accent text-xs text-muted-foreground truncate"
                          >
                            {col}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      <main className="flex flex-col min-h-0 overflow-hidden">
        <div className="border-b p-4 space-y-3">
          <div className="flex gap-2">
            <Tab active={mode === "run"} onClick={() => setMode("run")}>Run query</Tab>
            <Tab active={mode === "paste"} onClick={() => setMode("paste")}>Paste plan</Tab>
          </div>

          {mode === "run" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={connId}
                  onChange={(e) => setConnId(e.target.value)}
                  className="rounded-md bg-secondary px-2 py-1.5 text-sm flex-1"
                >
                  <option value="">Manual connection / PG* env</option>
                  {connections.map((cn) => (
                    <option key={cn.id} value={cn.id}>
                      {cn.name} {cn.database ? `(${cn.database})` : ""}
                    </option>
                  ))}
                </select>
                {!connId && (
                  <button type="button" onClick={saveConnection} className="rounded-md bg-secondary px-3 py-1.5 text-sm hover:bg-accent">
                    Save connection
                  </button>
                )}
              </div>
              {!connId && (
                <div className="grid grid-cols-5 gap-2">
                  <Input placeholder="host (blank = local socket)" value={conn.host} onChange={(v) => setConn({ ...conn, host: v })} />
                  <Input placeholder="port" value={conn.port} onChange={(v) => setConn({ ...conn, port: v })} />
                  <Input placeholder="database" value={conn.database} onChange={(v) => setConn({ ...conn, database: v })} />
                  <Input placeholder="user" value={conn.user} onChange={(v) => setConn({ ...conn, user: v })} />
                  <Input placeholder="password" type="password" value={conn.password} onChange={(v) => setConn({ ...conn, password: v })} />
                </div>
              )}
            </div>
          )}

          {mode === "paste" ? (
            <div className="rounded-md border overflow-hidden">
              <CodeEditor
                language="json"
                value={plan}
                onChange={setPlan}
                placeholder="Paste EXPLAIN (FORMAT JSON) output here"
                minHeight="140px"
              />
            </div>
          ) : null}

          <div className="rounded-md border overflow-hidden">
            <CodeEditor
              ref={editorRef}
              language="sql"
              value={sql}
              onChange={setSql}
              onRun={submit}
              schema={schemaMap}
              error={editorError}
              placeholder={mode === "run" ? "SELECT … — ⌘/Ctrl+Enter to run" : "Optional: the SQL, to enable lock warnings"}
              minHeight="120px"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Explaining…" : mode === "run" ? "Explain" : "Analyze"}
            </button>
            <button
              type="button"
              onClick={formatSql}
              className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-accent"
              title="Format SQL (Shift+⌘/Ctrl+F)"
            >
              Format
            </button>
            {mode === "run" && (
              <button type="button" onClick={checkLive} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm disabled:opacity-50">
                <Lock className="size-4" /> Live locks
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              {mode === "run" ? "Runs EXPLAIN (ANALYZE, BUFFERS) safely — rolled back, read-only." : "No database needed."}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {settings && <SettingsPanel settings={settings} onClose={() => setSettings(null)} />}
          {!settings && err && <ErrorCard err={err} />}
          {!settings && script && <ScriptResults script={script} />}
          {!settings && diff && !script && <DiffPanel diff={diff} onClose={() => setDiff(null)} />}
          {!settings && live && !diff && !script && <LiveLocksPanel live={live} onClose={() => setLive(null)} />}
          {!settings && report && !live && !diff && !script && <Results report={report} stats={tableStats} />}
          {!settings && !err && !report && !live && !diff && !script && <Empty />}
        </div>
      </main>
    </div>
  );
}

function cleanConn(c: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (!v) continue;
    out[k] = k === "port" ? Number(v) : v;
  }
  return out;
}

function Results({ report, stats }: { report: Report; stats: RelationStat[] }) {
  const [tab, setTab] = useState<"findings" | "plan" | "stats" | "tables" | "raw">("findings");
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const locks = report.diagnostics.filter((d) => isLock(d.code));
  const findings = report.diagnostics.filter((d) => !isLock(d.code));

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-4 border-l-4"
        style={{ borderColor: report.worstSeverity ? SEV_COLOR[report.worstSeverity] : "var(--sev-info)", background: "var(--card)" }}
      >
        <div className="font-medium">{report.verdict}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {report.summary.executionTimeMs != null && <>exec {report.summary.executionTimeMs.toFixed(1)} ms · </>}
          {report.summary.planningTimeMs != null && <>plan {report.summary.planningTimeMs.toFixed(1)} ms · </>}
          {report.summary.serializationTimeMs != null && <>serialize {report.summary.serializationTimeMs.toFixed(1)} ms · </>}
          {report.summary.nodeCount} nodes · {report.summary.hasBuffers ? "buffers" : "no buffers"}
          {report.server && <> · PG {report.server.major}</>}
        </div>
        {(report.jit?.timing?.total != null || (report.triggers?.length ?? 0) > 0 || report.settings) && (
          <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
            {report.jit?.timing?.total != null && (
              <span className="rounded bg-secondary px-2 py-0.5">JIT {report.jit.timing.total.toFixed(1)} ms{report.jit.functions ? ` · ${report.jit.functions} fn` : ""}</span>
            )}
            {(report.triggers?.length ?? 0) > 0 && (
              <span className="rounded bg-secondary px-2 py-0.5" title={report.triggers?.map((t) => `${t.name}: ${t.time?.toFixed(1)} ms`).join("\n")}>
                {report.triggers?.length} trigger{report.triggers?.length === 1 ? "" : "s"}
              </span>
            )}
            {report.settings && (
              <span className="rounded bg-secondary px-2 py-0.5" title={Object.entries(report.settings).map(([k, v]) => `${k} = ${v}`).join("\n")}>
                {Object.keys(report.settings).length} non-default setting{Object.keys(report.settings).length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <Tab active={tab === "findings"} onClick={() => setTab("findings")}>Findings ({findings.length})</Tab>
        <Tab active={tab === "plan"} onClick={() => setTab("plan")}>Plan</Tab>
        {report.stats && <Tab active={tab === "stats"} onClick={() => setTab("stats")}>Stats</Tab>}
        {stats.length > 0 && <Tab active={tab === "tables"} onClick={() => setTab("tables")}>Tables ({stats.length})</Tab>}
        {locks.length > 0 && <Tab active={false} onClick={() => setTab("findings")}><span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> {locks.length}</span></Tab>}
        <Tab active={tab === "raw"} onClick={() => setTab("raw")}>Raw JSON</Tab>
        <div className="ml-auto flex gap-1">
          <span className="text-xs text-muted-foreground self-center mr-1">Export</span>
          <button type="button" className="rounded-md bg-secondary px-2 py-1.5 text-sm hover:bg-accent" onClick={() => downloadText(JSON.stringify(report, null, 2), "report.json", "application/json")}>
            JSON
          </button>
          {report.runId && (
            <>
              <button type="button" className="rounded-md bg-secondary px-2 py-1.5 text-sm hover:bg-accent" onClick={() => exportReport(report.runId as string, "markdown", "report.md", "text/markdown")}>
                MD
              </button>
              <button type="button" className="rounded-md bg-secondary px-2 py-1.5 text-sm hover:bg-accent" onClick={() => exportReport(report.runId as string, "html", "report.html", "text/html")}>
                HTML
              </button>
            </>
          )}
        </div>
      </div>

      {tab === "findings" && (
        <div className="space-y-3">
          {locks.map((d, i) => <FindingCard key={`l${i}`} d={d} lock />)}
          {findings.map((d, i) => <FindingCard key={`f${i}`} d={d} />)}
          {report.diagnostics.length === 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" style={{ color: "var(--sev-info)" }} /> No findings — looks healthy.
            </div>
          )}
        </div>
      )}
      {tab === "plan" && (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 overflow-x-auto font-mono text-sm">
            <PlanTree node={report.plan} depth={0} onSelect={setSelected} selectedId={selected?.id} />
          </div>
          {selected && <NodeDetail node={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
      {tab === "stats" && report.stats && <StatsTab stats={report.stats} hasAnalyze={report.summary.hasAnalyze} />}
      {tab === "tables" && (
        <div className="space-y-2">
          {stats.map((s) => (
            <div key={s.relation} className="rounded-lg border p-3 text-sm" style={{ background: "var(--card)" }}>
              <div className="font-medium">{s.relation}</div>
              <div className="text-muted-foreground mt-1">
                ~{s.estRows?.toLocaleString() ?? "?"} rows · {fmtBytes(s.totalBytes)} · {s.indexes.length} index{s.indexes.length === 1 ? "" : "es"}
                {!s.lastAnalyze && !s.lastAutoanalyze && <span style={{ color: "var(--sev-warn)" }}> · never analyzed (stats may be stale)</span>}
              </div>
              {s.indexes.length > 0 && <div className="text-xs text-muted-foreground mt-1">indexes: {s.indexes.join(", ")}</div>}
            </div>
          ))}
        </div>
      )}
      {tab === "raw" && <pre className="text-xs overflow-x-auto bg-secondary rounded-md p-3">{JSON.stringify(report, null, 2)}</pre>}
    </div>
  );
}

function StatsTab({ stats, hasAnalyze }: { stats: PlanStats; hasAnalyze: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <StatTable title="By node type" rows={stats.byNodeType} hasAnalyze={hasAnalyze} />
      <StatTable title="By table" rows={stats.byRelation} hasAnalyze={hasAnalyze} />
      <StatTable title="By index" rows={stats.byIndex} hasAnalyze={hasAnalyze} />
    </div>
  );
}

function StatTable({ title, rows, hasAnalyze }: { title: string; rows: StatGroup[]; hasAnalyze: boolean }) {
  const [sort, setSort] = useState<"selfMs" | "count" | "key">(hasAnalyze ? "selfMs" : "count");
  const sorted = [...rows].sort((a, b) =>
    sort === "key" ? a.key.localeCompare(b.key) : sort === "count" ? b.count - a.count : b.selfMs - a.selfMs,
  );
  const maxMs = Math.max(...rows.map((r) => r.selfMs), 0.0001);
  const head = (id: "selfMs" | "count" | "key", label: string, cls = "") => (
    <button type="button" onClick={() => setSort(id)} className={`hover:text-foreground ${sort === id ? "text-foreground" : ""} ${cls}`}>
      {label}
    </button>
  );
  return (
    <div className="rounded-lg border p-3 min-w-0" style={{ background: "var(--card)" }}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        {title} <span className="normal-case">· {rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">—</div>
      ) : (
        <table className="w-full text-sm text-muted-foreground">
          <thead className="text-left text-xs">
            <tr>
              <th className="font-medium">{head("key", "Name")}</th>
              <th className="font-medium text-right w-10">{head("count", "n")}</th>
              {hasAnalyze && <th className="font-medium text-right">{head("selfMs", "self")}</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-t border-border/60">
                <td className="py-1 pr-2 text-foreground truncate max-w-[10rem]" title={r.key}>{r.key}</td>
                <td className="py-1 text-right tabular-nums">{r.count}</td>
                {hasAnalyze && (
                  <td className="py-1 text-right tabular-nums whitespace-nowrap">
                    <span
                      className="inline-block align-middle mr-1 h-1.5 rounded"
                      style={{ width: `${Math.round((r.selfMs / maxMs) * 36)}px`, background: "var(--sev-info)" }}
                    />
                    {r.selfMs.toFixed(1)}ms <span className="text-xs">({r.pctOfTotal.toFixed(0)}%)</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FindingCard({ d, lock }: { d: Diagnostic; lock?: boolean }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: "var(--card)" }}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded text-white" style={{ background: SEV_COLOR[d.severity] }}>
          {SEV_LABEL[d.severity]}
        </span>
        {lock && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-secondary"><Lock className="size-3" /> lock</span>}
        <span className="font-medium">{d.title}</span>
        <span className="text-xs text-muted-foreground ml-auto">{d.code}</span>
      </div>
      <p className="text-sm mt-2"><b>What:</b> {d.detail}</p>
      <p className="text-sm text-muted-foreground"><b>Why:</b> {d.cause}</p>
      <p className="text-sm mt-1"><b>Fix:</b> {d.remediation.summary}</p>
      {d.remediation.commands?.map((cmd, i) => (
        <pre key={i} className="text-xs bg-secondary rounded p-2 mt-2 overflow-x-auto">{cmd.sql ?? cmd.shell}</pre>
      ))}
      {d.docsUrl && <a className="inline-flex items-center gap-1 text-xs text-sev-info underline" href={d.docsUrl} target="_blank" rel="noreferrer">PostgreSQL docs <ExternalLink className="size-3" /></a>}
    </div>
  );
}

function PlanTree({ node, depth, onSelect, selectedId }: { node: PlanNode; depth: number; onSelect: (n: PlanNode) => void; selectedId?: number }) {
  const m = node.metrics;
  const pct = m.pctOfTotal ?? 0;
  const heat = pct >= 50 ? "var(--sev-error)" : pct >= 20 ? "var(--sev-warn)" : undefined;
  const label = `${node.nodeType}${node.relationName ? ` on ${node.relationName}` : ""}${node.indexName ? ` using ${node.indexName}` : ""}`;
  const neverRan = node.actualLoops === 0;
  return (
    <div>
      <div style={{ paddingLeft: `${depth * 16}px` }}>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className={`text-left hover:bg-accent rounded px-1 -mx-1 ${selectedId === node.id ? "bg-accent ring-1 ring-[var(--sev-info)]" : ""}`}
        >
          <span style={{ color: heat, fontWeight: heat ? 600 : 400 }}>
            {depth > 0 && <CornerDownRight className="inline size-3 mr-1 -translate-y-px text-muted-foreground" />}
            {label}
          </span>
          <span className="text-muted-foreground">
            {neverRan && " (never executed)"}
            {m.totalRows != null && `  rows=${m.totalRows.toLocaleString()}`}
            {m.estimateFactor != null && m.estimateFactor >= 2 && m.estimateDirection !== "accurate" && ` (${m.estimateFactor.toFixed(0)}× ${m.estimateDirection})`}
            {m.selfMs != null && `  self ${m.selfMs.toFixed(1)} ms`}
            {m.pctOfTotal != null && m.pctOfTotal >= 1 && ` (${m.pctOfTotal.toFixed(0)}%)`}
          </span>
        </button>
      </div>
      {node.children.map((c) => <PlanTree key={c.id} node={c} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} />)}
    </div>
  );
}

function ScriptResults({ script }: { script: ScriptAnalysis }) {
  const analyzed = script.units.filter((u) => u.status === "analyzed").length;
  const skipped = script.units.length - analyzed;
  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3 border-l-4" style={{ borderColor: "var(--sev-info)", background: "var(--card)" }}>
        <div className="font-medium">Cost-only analysis — nothing was executed</div>
        <div className="text-xs text-muted-foreground mt-1">
          Extracted {script.units.length} statement(s) · {analyzed} analyzed, {skipped} skipped. No rows
          touched, no sequences advanced, no triggers fired{script.serverMajor ? ` · PG ${script.serverMajor}` : ""}.
        </div>
      </div>
      {script.units.map((u, i) => (
        <div key={`${u.label}-${i}`} className="space-y-2">
          <div className="flex items-center gap-1 font-medium text-sm">
            <ChevronRight className="size-4 shrink-0" /> {u.label}
            {u.loopNote && <span className="text-muted-foreground"> ({u.loopNote})</span>}
          </div>
          {u.status === "analyzed" && u.report ? (
            <Results report={u.report} stats={[]} />
          ) : (
            <div className="rounded-lg border p-3 text-sm" style={{ background: "var(--card)" }}>
              <span style={{ color: u.status === "error" ? "var(--sev-warn)" : "var(--muted-foreground)" }}>
                {u.status === "error" ? "Could not analyze" : "Skipped"}:
              </span>{" "}
              {u.reason}
              {u.errorCode && <span className="text-xs text-muted-foreground"> [{u.errorCode}]</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LiveLocksPanel({ live, onClose }: { live: LiveLocks; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Live locks</h2>
        <span className="text-xs text-muted-foreground">
          {live.sessions.length} client sessions · {live.blocked.length} blocked
        </span>
        <button type="button" className="ml-auto text-sm rounded-md bg-secondary px-3 py-1" onClick={onClose}>
          Close
        </button>
      </div>
      {live.blocked.length === 0 ? (
        <div className="text-sm text-muted-foreground rounded-lg border p-4" style={{ background: "var(--card)" }}>
          No lock contention right now — nothing is waiting on another session.
        </div>
      ) : (
        live.blocked.map((s) => (
          <div key={s.pid} className="rounded-lg border-l-4 p-3" style={{ borderColor: "var(--sev-warn)", background: "var(--card)" }}>
            <div className="text-sm">
              <b>pid {s.pid}</b> ({s.user ?? "?"}) is <b>blocked by</b> pid {s.blockedBy.join(", ")}
              {s.ageSeconds != null && <span className="text-muted-foreground"> · waiting {s.ageSeconds.toFixed(0)}s</span>}
              {s.waitEvent && <span className="text-muted-foreground"> · {s.waitEvent}</span>}
            </div>
            {s.query && <pre className="text-xs bg-secondary rounded p-2 mt-2 overflow-x-auto">{s.query}</pre>}
            <p className="text-xs text-muted-foreground mt-2">
              Inspect the blocker; if needed, cancel it with <code>SELECT pg_cancel_backend({s.blockedBy[0]});</code> or terminate with <code>pg_terminate_backend(…)</code>.
            </p>
          </div>
        ))
      )}
    </div>
  );
}

function SettingsPanel({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [thresholds, setThresholds] = useState<Record<string, number>>(settings.thresholds);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    await api.saveSettings({ thresholds, rules: settings.rules });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Settings</h2>
        <span className="text-xs text-muted-foreground">Advisor thresholds — saved to your data dir and applied to new analyses.</span>
        <button type="button" className="ml-auto text-sm rounded-md bg-secondary px-3 py-1" onClick={onClose}>Close</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(thresholds).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-muted-foreground">{key}</span>
            <input
              type="number"
              value={value}
              onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
              className="w-28 rounded-md bg-secondary px-2 py-1 text-sm"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
          Save
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-sm" style={{ color: "var(--sev-info)" }}><Check className="size-4" /> Saved</span>}
        <span className="text-xs text-muted-foreground">Per-rule enable/severity overrides are editable in the config file.</span>
      </div>
    </div>
  );
}

function DiffPanel({ diff, onClose }: { diff: DiffResult; onClose: () => void }) {
  const slower = (diff.execDeltaMs ?? 0) > 0;
  const headline =
    diff.execDeltaMs == null
      ? "Compared plans"
      : `${Math.abs(diff.execDeltaMs).toFixed(1)} ms ${slower ? "slower" : "faster"}${diff.execDeltaPct != null ? ` (${diff.execDeltaPct >= 0 ? "+" : ""}${diff.execDeltaPct.toFixed(1)}%)` : ""}`;

  const rows = (title: string, items: SigDelta[], color: string) =>
    items.length > 0 && (
      <div>
        <div className="text-sm font-medium mt-3 mb-1">{title}</div>
        {items.slice(0, 12).map((d) => (
          <div key={d.signature} className="text-sm flex gap-2">
            <span className="flex-1 truncate">{d.signature}</span>
            <span style={{ color }}>
              {d.deltaMs >= 0 ? "+" : ""}
              {d.deltaMs.toFixed(1)} ms{d.deltaPct != null ? ` (${d.deltaPct >= 0 ? "+" : ""}${d.deltaPct.toFixed(0)}%)` : ""}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Diff (before → after)</h2>
        <span className="text-sm" style={{ color: slower ? "var(--sev-error)" : "var(--sev-info)" }}>{headline}</span>
        <button type="button" className="ml-auto text-sm rounded-md bg-secondary px-3 py-1" onClick={onClose}>Close</button>
      </div>
      {rows("Regressed (slower)", diff.regressed, "var(--sev-error)")}
      {rows("Improved (faster)", diff.improved, "var(--sev-info)")}
      {rows("Added nodes", diff.added, "var(--muted-foreground)")}
      {rows("Removed nodes", diff.removed, "var(--muted-foreground)")}
      {diff.newFindings.length > 0 && (
        <div>
          <div className="text-sm font-medium mt-3 mb-1" style={{ color: "var(--sev-error)" }}>New findings</div>
          {diff.newFindings.map((f, i) => <div key={i} className="flex items-center gap-1 text-sm"><Plus className="size-3.5 shrink-0" style={{ color: "var(--sev-error)" }} /> {f.title} <span className="text-xs text-muted-foreground">{f.code}</span></div>)}
        </div>
      )}
      {diff.resolvedFindings.length > 0 && (
        <div>
          <div className="text-sm font-medium mt-3 mb-1" style={{ color: "var(--sev-info)" }}>Resolved findings</div>
          {diff.resolvedFindings.map((f, i) => <div key={i} className="flex items-center gap-1 text-sm"><Minus className="size-3.5 shrink-0" style={{ color: "var(--sev-info)" }} /> {f.title} <span className="text-xs text-muted-foreground">{f.code}</span></div>)}
        </div>
      )}
    </div>
  );
}

function downloadText(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `pgexplain-${filename}`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportReport(runId: string, format: "markdown" | "html" | "text", filename: string, mime: string) {
  try {
    downloadText(await api.export(runId, format), filename, mime);
  } catch {
    // best-effort; the report tab still shows everything
  }
}

function ErrorCard({ err }: { err: ApiError }) {
  return (
    <div className="rounded-lg border-l-4 p-4" style={{ borderColor: "var(--sev-error)", background: "var(--card)" }}>
      <div className="font-medium">{err.title} <span className="text-xs text-muted-foreground">{err.code}</span></div>
      {err.detail && <p className="text-sm mt-1">{err.detail}</p>}
      {err.remediation?.summary && <p className="text-sm mt-1"><b>Fix:</b> {err.remediation.summary}</p>}
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center text-center text-muted-foreground">
      <div>
        <div className="text-lg">Run a query or paste a plan</div>
        <div className="text-sm mt-1">Findings tell you what's slow and exactly how to fix it.</div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}
    >
      {children}
    </button>
  );
}

function Input({ placeholder, value, onChange, type = "text" }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md bg-secondary px-2 py-1.5 text-sm"
    />
  );
}
