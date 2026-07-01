import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tab } from "@/components/ui/tab";
import { Toaster, toast } from "@/components/ui/toast";
import { ChevronDown, ChevronRight, Lock, Moon, PanelLeft, Settings as SettingsIcon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format as formatSqlText } from "sql-formatter";
import { CodeEditor, type CodeEditorHandle } from "./components/CodeEditor.tsx";
import { DiffPanel } from "./components/DiffPanel.tsx";
import { LiveLocksPanel } from "./components/LiveLocksPanel.tsx";
import { Results } from "./components/Results.tsx";
import { ScriptResults } from "./components/ScriptResults.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { api, type ApiError, type ConnectionPublic, type DiffResult, type LiveLocks, type RelationStat, type Report, type RunSummary, type ScriptAnalysis, type Settings, type TableInfo } from "./lib/api.ts";
import { SEV_COLOR } from "./lib/severity.ts";
import { collectRelations, isScripty } from "./lib/utils.ts";

const MANUAL_CONN = "__manual__";

export function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const editorRef = useRef<CodeEditorHandle>(null);

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.verdict.toLowerCase().includes(q) ||
        h.kind.includes(q) ||
        new Date(h.createdAt).toLocaleString().toLowerCase().includes(q),
    );
  }, [history, historyQuery]);

  const schemaMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const t of catalog) {
      m[t.name] = t.columns;
      m[`${t.schema}.${t.name}`] = t.columns;
    }
    return m;
  }, [catalog]);

  const formatSql = useCallback(() => {
    setSql((s) => {
      try {
        return formatSqlText(s, { language: "postgresql" });
      } catch {
        return s; // leave malformed SQL untouched
      }
    });
  }, []);

  useEffect(() => {
    const inEditor = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest("input, textarea, [contenteditable=true]");
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        editorRef.current?.focus();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        formatSql();
      } else if (e.key === "?" && !mod && !inEditor(e.target)) {
        setShowShortcuts((v) => !v);
      } else if (e.key === "Escape") {
        setShowShortcuts(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formatSql]);

  const refreshHistory = useCallback(() => {
    api.history().then((r) => setHistory(r.runs)).catch(() => {});
  }, []);
  const refreshConnections = useCallback(() => {
    api.connections().then((r) => setConnections(r.connections)).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory]);
  useEffect(refreshConnections, [refreshConnections]);

  useEffect(() => {
    if (!connId) { setCatalog([]); return; }
    let cancelled = false;
    api.catalog({ connectionId: connId }).then((r) => !cancelled && setCatalog(r.tables)).catch(() => {});
    return () => { cancelled = true; };
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
      if (mode === "run" && isScripty(sql)) {
        setScript(await api.analyzeSql({ ...connBody, sql }));
        setReport(null);
        return;
      }
      const r = mode === "run"
        ? await api.run({ ...connBody, sql })
        : await api.analyze(plan, sql.trim() || undefined);
      setReport(r);
      setTableStats([]);
      if (r.runId) window.location.hash = `run=${r.runId}`;
      refreshHistory();
      if (mode === "run") {
        const relations = collectRelations(r.plan);
        if (relations.length) {
          api.schema({ ...connBody, relations }).then((s) => setTableStats(s.relations)).catch(() => {});
        }
        if (!connId && catalog.length === 0) {
          api.catalog(connBody).then((res) => setCatalog(res.tables)).catch(() => {});
        }
      }
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae);
      setReport(null);
      const pos = ae.meta?.position;
      if (mode === "run" && typeof pos === "number" && pos > 0) {
        setEditorError({ offset: pos - 1, message: ae.detail || ae.title });
      }
    } finally {
      setBusy(false);
    }
  };

  const openRun = useCallback(async (id: string) => {
    try {
      const r = await api.getRun(id);
      setReport({ ...r.report, runId: r.id });
      setTableStats([]);
      setLive(null);
      setDiff(null);
      setScript(null);
      setErr(null);
      window.location.hash = `run=${r.id}`;
    } catch (e) {
      setErr(e as ApiError);
      toast("Run not found — it may have been deleted from history.", "error");
      window.location.hash = "";
    }
  }, []);

  // Shareable URLs: #run=<id> deep-links a stored run on load.
  useEffect(() => {
    const id = window.location.hash.match(/^#run=(.+)$/)?.[1];
    if (id) openRun(decodeURIComponent(id));
  }, [openRun]);

  const onHistoryClick = (id: string) => {
    if (!diffMode) { openRun(id); return; }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  };

  const runDiff = async () => {
    if (picked.length !== 2) return;
    setErr(null);
    try {
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
    <div className={`h-screen grid overflow-hidden ${sidebarOpen ? "grid-cols-1 md:grid-cols-[260px_1fr]" : "grid-cols-1"}`}>
      {sidebarOpen && (
      <aside className="border-r hidden md:flex flex-col min-h-0" aria-label="History and schema">
        <div className="px-4 py-3 border-b">
          <div className="font-semibold">pgexplain studio</div>
          <div className="text-xs text-muted-foreground">PostgreSQL EXPLAIN, locally</div>
        </div>
        <div className="px-3 py-2 flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground flex-1">History</span>
          <Button
            variant={diffMode ? "default" : "secondary"}
            size="sm"
            onClick={() => { setDiffMode((v) => !v); setPicked([]); }}
          >
            Compare
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setDark((v) => !v)}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Settings"
            onClick={async () => setSettings(await api.settings())}
          >
            <SettingsIcon className="size-4" />
          </Button>
        </div>
        {diffMode && (
          <div className="px-3 pb-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={picked.length !== 2}
              onClick={runDiff}
            >
              Diff selected ({picked.length}/2)
            </Button>
          </div>
        )}
        {history.length > 0 && (
          <div className="px-3 pb-2">
            <Input
              placeholder="Filter history…"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {history.length === 0 && <div className="px-2 text-sm text-muted-foreground">No runs yet.</div>}
          {history.length > 0 && filteredHistory.length === 0 && (
            <div className="px-2 text-sm text-muted-foreground">No runs match "{historyQuery}".</div>
          )}
          {filteredHistory.map((h) => (
            <Button
              key={h.id}
              variant="ghost"
              onClick={() => onHistoryClick(h.id)}
              className={`w-full flex-col items-start h-auto px-2 py-2 font-normal whitespace-normal ${picked.includes(h.id) ? "ring-2 ring-[var(--sev-info)]" : ""}`}
            >
              <div className="flex items-center gap-2 w-full">
                <span className="size-2 rounded-full shrink-0" style={{ background: h.worstSeverity ? SEV_COLOR[h.worstSeverity] : "var(--sev-info)" }} />
                <span className="truncate flex-1 text-sm text-left">{h.verdict || h.kind}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 w-full text-left">
                {h.kind} · {h.execMs != null ? `${h.execMs.toFixed(0)} ms` : "no timing"}
              </div>
            </Button>
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
                      <Button
                        variant="ghost"
                        onClick={() => setOpenTable(open ? null : key)}
                        className="h-5 w-5 p-0 text-muted-foreground shrink-0"
                      >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => editorRef.current?.insertText(t.name)}
                        title={`${key} — click to insert`}
                        className="flex-1 justify-start h-7 px-1 text-sm min-w-0"
                      >
                        <span className="truncate">{t.name}</span>
                      </Button>
                    </div>
                    {open && (
                      <div className="ml-5 border-l pl-2 space-y-0.5 py-0.5">
                        {t.columns.map((col) => (
                          <Button
                            key={col}
                            variant="ghost"
                            onClick={() => editorRef.current?.insertText(col)}
                            className="w-full justify-start h-6 px-1 text-xs text-muted-foreground font-normal min-w-0"
                          >
                            <span className="truncate">{col}</span>
                          </Button>
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
      )}

      <main className="flex flex-col min-h-0 overflow-hidden">
        <div className="border-b p-4 space-y-3">
          <div className="flex gap-2 items-center" role="tablist" aria-label="Input mode">
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <PanelLeft className="size-4" />
            </Button>
            <Tab active={mode === "run"} onClick={() => setMode("run")}>Run query</Tab>
            <Tab active={mode === "paste"} onClick={() => setMode("paste")}>Paste plan</Tab>
          </div>

          {mode === "run" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Select value={connId || MANUAL_CONN} onValueChange={(v) => setConnId(v === MANUAL_CONN ? "" : v)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MANUAL_CONN}>Manual connection / PG* env</SelectItem>
                    {connections.map((cn) => (
                      <SelectItem key={cn.id} value={cn.id}>
                        {cn.name} {cn.database ? `(${cn.database})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!connId && (
                  <Button variant="secondary" size="sm" onClick={saveConnection}>
                    Save connection
                  </Button>
                )}
              </div>
              {!connId && (
                <div className="grid grid-cols-5 gap-2">
                  <Input placeholder="host (blank = local socket)" value={conn.host} onChange={(e) => setConn({ ...conn, host: e.target.value })} />
                  <Input placeholder="port" value={conn.port} onChange={(e) => setConn({ ...conn, port: e.target.value })} />
                  <Input placeholder="database" value={conn.database} onChange={(e) => setConn({ ...conn, database: e.target.value })} />
                  <Input placeholder="user" value={conn.user} onChange={(e) => setConn({ ...conn, user: e.target.value })} />
                  <Input type="password" placeholder="password" value={conn.password} onChange={(e) => setConn({ ...conn, password: e.target.value })} />
                </div>
              )}
            </div>
          )}

          {mode === "paste" ? (
            <div className="rounded-md border overflow-hidden">
              <CodeEditor language="json" value={plan} onChange={setPlan} placeholder="Paste EXPLAIN (FORMAT JSON) output here" minHeight="140px" />
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
            <Button onClick={submit} disabled={busy}>
              {busy ? "Explaining…" : mode === "run" ? "Explain" : "Analyze"}
            </Button>
            <Button variant="secondary" onClick={formatSql} title="Format SQL (Shift+⌘/Ctrl+F)">
              Format
            </Button>
            {mode === "run" && (
              <Button variant="secondary" onClick={checkLive} disabled={busy}>
                <Lock className="size-4" /> Live locks
              </Button>
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

      {showShortcuts && (
        <div
          className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center"
          onClick={() => setShowShortcuts(false)}
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <div className="rounded-lg border bg-card p-5 text-sm shadow-xl min-w-64" onClick={(e) => e.stopPropagation()}>
            <div className="font-medium mb-3">Keyboard shortcuts</div>
            <ShortcutRow keys="⌘/Ctrl + Enter" label="Run / analyze" />
            <ShortcutRow keys="⌘/Ctrl + K" label="Focus SQL editor" />
            <ShortcutRow keys="⇧ + ⌘/Ctrl + F" label="Format SQL" />
            <ShortcutRow keys="?" label="Toggle this help" />
            <ShortcutRow keys="Esc" label="Close" />
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-4 py-1">
      <kbd className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">{keys}</kbd>
      <span className="text-muted-foreground ml-auto">{label}</span>
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
