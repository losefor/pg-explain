import { X } from "lucide-react";
import type { PlanNode } from "../lib/api.ts";
import { describeNode } from "../lib/nodeDescriptions.ts";

const n = (v?: number | null): string => (v == null ? "—" : v.toLocaleString());
const ms = (v?: number | null): string => (v == null ? "—" : `${v.toFixed(v < 10 ? 2 : 1)} ms`);
const kb = (v?: number | null): string => (v == null ? "—" : `${v.toLocaleString()} kB`);

export function nodeTitle(node: PlanNode): string {
  let s = node.nodeType;
  if (node.indexName && node.relationName) s += ` using ${node.indexName} on ${node.relationName}`;
  else if (node.relationName) s += ` on ${node.relationName}`;
  else if (node.indexName) s += ` on ${node.indexName}`;
  if (node.alias && node.alias !== node.relationName) s += ` (${node.alias})`;
  return s;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "—" || value === "") return null;
  return (
    <div className="flex gap-2 text-sm py-0.5">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mt-3 mb-1">{title}</div>
      {children}
    </div>
  );
}

const hasBuffers = (d: PlanNode) =>
  [
    d.sharedHitBlocks, d.sharedReadBlocks, d.sharedDirtiedBlocks, d.sharedWrittenBlocks,
    d.localHitBlocks, d.localReadBlocks, d.tempReadBlocks, d.tempWrittenBlocks,
    d.ioReadTime, d.ioWriteTime, d.walRecords,
  ].some((v) => v != null);

const conds = (d: PlanNode) =>
  d.filter || d.indexCond || d.recheckCond || d.hashCond || d.joinFilter || (d.sortKey?.length ?? 0) > 0;

export function NodeDetail({ node, onClose }: { node: PlanNode; onClose?: () => void }) {
  const m = node.metrics;
  const desc = describeNode(node.nodeType);
  const est =
    m.estimateFactor != null && m.estimateDirection && m.estimateDirection !== "accurate"
      ? `${m.estimateFactor.toFixed(m.estimateFactor < 10 ? 1 : 0)}× ${m.estimateDirection}-estimated`
      : "accurate";

  return (
    <div className="rounded-lg border p-3 text-sm w-full lg:w-96 shrink-0 self-start" style={{ background: "var(--card)" }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium break-words">{nodeTitle(node)}</div>
          {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" title="Close">
            <X className="size-4" />
          </button>
        )}
      </div>

      <Section title="General">
        <Row label="Rows (actual / planned)" value={`${n(m.totalRows ?? node.actualRows)} / ${n(node.planRows)}`} />
        <Row label="Estimate" value={est} />
        <Row label="Loops" value={node.actualLoops != null ? n(node.actualLoops) : null} />
        <Row label="Self time" value={m.selfMs != null ? `${ms(m.selfMs)}${m.pctOfTotal != null ? ` (${m.pctOfTotal.toFixed(0)}%)` : ""}` : null} />
        <Row label="Total time (incl.)" value={m.inclusiveMs != null ? ms(m.inclusiveMs) : null} />
        <Row label="Cost (startup..total)" value={node.totalCost != null ? `${node.startupCost ?? 0}..${node.totalCost}` : null} />
        <Row label="Row width" value={node.planWidth != null ? `${node.planWidth} B` : null} />
      </Section>

      {conds(node) && (
        <Section title="Conditions">
          <Row label="Filter" value={node.filter} />
          <Row label="Rows removed" value={node.rowsRemovedByFilter != null ? n(node.rowsRemovedByFilter) : null} />
          <Row label="Index Cond" value={node.indexCond} />
          <Row label="Recheck Cond" value={node.recheckCond} />
          <Row label="Hash Cond" value={node.hashCond} />
          <Row label="Join Filter" value={node.joinFilter} />
          <Row label="Sort Key" value={node.sortKey?.join(", ")} />
        </Section>
      )}

      {(node.sortMethod || node.hashBatches != null || node.peakMemoryUsage != null || node.heapFetches != null || node.lossyHeapBlocks != null) && (
        <Section title="Memory & work">
          <Row label="Sort method" value={node.sortMethod} />
          <Row label="Sort space" value={node.sortSpaceUsed != null ? `${kb(node.sortSpaceUsed)} (${node.sortSpaceType ?? "?"})` : null} />
          <Row label="Peak memory" value={node.peakMemoryUsage != null ? kb(node.peakMemoryUsage) : null} />
          <Row label="Hash batches" value={node.hashBatches != null ? `${node.hashBatches}${node.hashBuckets != null ? ` · ${n(node.hashBuckets)} buckets` : ""}` : null} />
          <Row label="Disk usage" value={node.diskUsage != null ? kb(node.diskUsage) : null} />
          <Row label="Heap fetches" value={node.heapFetches != null ? n(node.heapFetches) : null} />
          <Row label="Bitmap heap blocks" value={node.lossyHeapBlocks != null ? `${n(node.exactHeapBlocks)} exact / ${n(node.lossyHeapBlocks)} lossy` : null} />
        </Section>
      )}

      {hasBuffers(node) && (
        <Section title="Buffers & I/O">
          <Row label="Shared (hit/read)" value={node.sharedHitBlocks != null || node.sharedReadBlocks != null ? `${n(node.sharedHitBlocks ?? 0)} / ${n(node.sharedReadBlocks ?? 0)}` : null} />
          <Row label="Shared (dirtied/written)" value={node.sharedDirtiedBlocks != null || node.sharedWrittenBlocks != null ? `${n(node.sharedDirtiedBlocks ?? 0)} / ${n(node.sharedWrittenBlocks ?? 0)}` : null} />
          <Row label="Local (hit/read)" value={node.localHitBlocks != null || node.localReadBlocks != null ? `${n(node.localHitBlocks ?? 0)} / ${n(node.localReadBlocks ?? 0)}` : null} />
          <Row label="Temp (read/written)" value={node.tempReadBlocks != null || node.tempWrittenBlocks != null ? `${n(node.tempReadBlocks ?? 0)} / ${n(node.tempWrittenBlocks ?? 0)}` : null} />
          <Row label="I/O time (read/write)" value={node.ioReadTime != null || node.ioWriteTime != null ? `${ms(node.ioReadTime ?? 0)} / ${ms(node.ioWriteTime ?? 0)}` : null} />
          <Row label="Cache hit ratio" value={m.cacheHitRatio != null ? `${(m.cacheHitRatio * 100).toFixed(1)}%` : null} />
          <Row label="WAL (records/bytes/fpi)" value={node.walRecords != null ? `${n(node.walRecords)} / ${n(node.walBytes)} / ${n(node.walFpi)}` : null} />
        </Section>
      )}

      {node.workers && node.workers.length > 0 && (
        <Section title={`Workers (${node.workers.length})`}>
          <table className="w-full text-xs text-muted-foreground">
            <thead className="text-left">
              <tr>
                <th className="font-medium">#</th>
                <th className="font-medium text-right">rows</th>
                <th className="font-medium text-right">loops</th>
                <th className="font-medium text-right">time</th>
              </tr>
            </thead>
            <tbody>
              {node.workers.map((w) => (
                <tr key={w.number}>
                  <td className="text-foreground">{w.number}</td>
                  <td className="text-right tabular-nums">{n(w.actualRows)}</td>
                  <td className="text-right tabular-nums">{n(w.actualLoops)}</td>
                  <td className="text-right tabular-nums">{ms(w.actualTotalTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {node.output && node.output.length > 0 && (
        <Section title="Output">
          <div className="font-mono text-xs break-words text-muted-foreground">{node.output.join(", ")}</div>
        </Section>
      )}
    </div>
  );
}
