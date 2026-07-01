import { Button } from "@/components/ui/button";
import { Tab } from "@/components/ui/tab";
import { toast } from "@/components/ui/toast";
import { CheckCircle2, CornerDownRight, ExternalLink, Link as LinkIcon, Lock } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { api, type ApiError, type Diagnostic, type PlanNode, type PlanStats, type RelationStat, type Report, type StatGroup } from "../lib/api.ts";
import { isLock, SEV_COLOR, SEV_LABEL } from "../lib/severity.ts";
import { fmtBytes } from "../lib/utils.ts";
import { NodeDetail } from "./NodeDetail.tsx";

const PlanGraph = lazy(() => import("./PlanGraph.tsx").then((m) => ({ default: m.PlanGraph })));

export function Results({ report, stats }: { report: Report; stats: RelationStat[] }) {
  const [tab, setTab] = useState<"findings" | "plan" | "stats" | "tables" | "raw">("findings");
  const [selected, setSelected] = useState<PlanNode | null>(null);
  const [planView, setPlanView] = useState<"graph" | "text">("graph");
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

      <div className="flex gap-2 items-center flex-wrap" role="tablist" aria-label="Report sections">
        <Tab active={tab === "findings"} onClick={() => setTab("findings")}>Findings ({findings.length})</Tab>
        <Tab active={tab === "plan"} onClick={() => setTab("plan")}>Plan</Tab>
        {report.stats && <Tab active={tab === "stats"} onClick={() => setTab("stats")}>Stats</Tab>}
        {stats.length > 0 && <Tab active={tab === "tables"} onClick={() => setTab("tables")}>Tables ({stats.length})</Tab>}
        {locks.length > 0 && (
          <Tab active={false} onClick={() => setTab("findings")}>
            <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> {locks.length}</span>
          </Tab>
        )}
        <Tab active={tab === "raw"} onClick={() => setTab("raw")}>Raw JSON</Tab>
        <div className="ml-auto flex gap-1 items-center">
          <span className="text-xs text-muted-foreground mr-1">Export</span>
          <Button variant="secondary" size="sm" onClick={() => downloadText(JSON.stringify(report, null, 2), "report.json", "application/json")}>
            JSON
          </Button>
          {report.runId && (
            <>
              <Button variant="secondary" size="sm" onClick={() => exportReport(report.runId as string, "markdown", "report.md", "text/markdown")}>
                MD
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportReport(report.runId as string, "html", "report.html", "text/html")}>
                HTML
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="Copy a link to this run"
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}#run=${report.runId}`;
                  navigator.clipboard.writeText(url).then(
                    () => toast("Link copied — anyone with access to this studio can open it."),
                    () => toast("Could not copy the link.", "error"),
                  );
                }}
              >
                <LinkIcon className="size-3.5" /> Link
              </Button>
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
          <div className="flex-1 min-w-0">
            <div className="flex gap-1 mb-2" role="tablist" aria-label="Plan view">
              <Tab active={planView === "graph"} onClick={() => setPlanView("graph")}>Graph</Tab>
              <Tab active={planView === "text"} onClick={() => setPlanView("text")}>Text</Tab>
            </div>
            {planView === "graph" ? (
              <Suspense fallback={<div className="text-sm text-muted-foreground p-4">Loading graph…</div>}>
                <PlanGraph root={report.plan} onSelect={setSelected} selectedId={selected?.id} />
              </Suspense>
            ) : (
              <div className="overflow-x-auto font-mono text-sm">
                <PlanTree node={report.plan} depth={0} onSelect={setSelected} selectedId={selected?.id} />
              </div>
            )}
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
    <Button
      variant="ghost"
      onClick={() => setSort(id)}
      className={`h-auto p-0 text-xs font-medium ${sort === id ? "text-foreground" : "text-muted-foreground"} ${cls}`}
    >
      {label}
    </Button>
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

export function FindingCard({ d, lock }: { d: Diagnostic; lock?: boolean }) {
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

export function PlanTree({ node, depth, onSelect, selectedId }: { node: PlanNode; depth: number; onSelect: (n: PlanNode) => void; selectedId?: number }) {
  const m = node.metrics;
  const pct = m.pctOfTotal ?? 0;
  const heat = pct >= 50 ? "var(--sev-error)" : pct >= 20 ? "var(--sev-warn)" : undefined;
  const label = `${node.nodeType}${node.relationName ? ` on ${node.relationName}` : ""}${node.indexName ? ` using ${node.indexName}` : ""}`;
  const neverRan = node.actualLoops === 0;
  return (
    <div>
      <div style={{ paddingLeft: `${depth * 16}px` }}>
        <Button
          variant="ghost"
          onClick={() => onSelect(node)}
          className={`h-auto px-1 -mx-1 justify-start font-normal whitespace-normal text-left ${selectedId === node.id ? "bg-accent ring-1 ring-[var(--sev-info)]" : ""}`}
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
        </Button>
      </div>
      {node.children.map((c) => <PlanTree key={c.id} node={c} depth={depth + 1} onSelect={onSelect} selectedId={selectedId} />)}
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
  } catch (e) {
    const ae = e as ApiError;
    toast(`Export failed: ${ae.detail || ae.title || "server unreachable"}`, "error");
  }
}
