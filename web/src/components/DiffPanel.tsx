import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import type { DiffResult, PlanNode, SigDelta } from "../lib/api.ts";

/** Mirrors core nodeLabel() so signatures line up with the server's diff lists. */
function sigOf(node: PlanNode): string {
  let label = node.nodeType;
  if (node.indexName && node.relationName) label += ` using ${node.indexName} on ${node.relationName}`;
  else if (node.relationName) label += ` on ${node.relationName}`;
  if (node.alias && node.alias !== node.relationName) label += ` (${node.alias})`;
  return label;
}

type NodeClass = "regressed" | "improved" | "added" | "removed";

const CLASS_COLOR: Record<NodeClass, string> = {
  regressed: "var(--sev-error)",
  improved: "var(--sev-info)",
  added: "var(--sev-warn)",
  removed: "var(--muted-foreground)",
};

function classify(diff: DiffResult): Map<string, NodeClass> {
  const m = new Map<string, NodeClass>();
  for (const d of diff.removed) m.set(d.signature, "removed");
  for (const d of diff.added) m.set(d.signature, "added");
  for (const d of diff.improved) m.set(d.signature, "improved");
  for (const d of diff.regressed) m.set(d.signature, "regressed");
  return m;
}

function DiffTree({ node, depth, classes, side }: { node: PlanNode; depth: number; classes: Map<string, NodeClass>; side: "before" | "after" }) {
  const cls = classes.get(sigOf(node));
  // "added" only colors the after tree; "removed" only the before tree.
  const shown = cls === "added" ? (side === "after" ? cls : undefined) : cls === "removed" ? (side === "before" ? cls : undefined) : cls;
  const m = node.metrics;
  return (
    <div>
      <div
        className={`whitespace-nowrap ${shown === "removed" ? "line-through opacity-60" : ""}`}
        style={{ paddingLeft: `${depth * 16}px`, color: shown ? CLASS_COLOR[shown] : undefined }}
      >
        {sigOf(node)}
        <span className="text-muted-foreground text-xs">
          {m.selfMs != null && `  self ${m.selfMs.toFixed(1)} ms`}
          {m.totalRows != null && `  rows=${m.totalRows.toLocaleString()}`}
        </span>
      </div>
      {node.children.map((c) => <DiffTree key={c.id} node={c} depth={depth + 1} classes={classes} side={side} />)}
    </div>
  );
}

export function DiffPanel({ diff, onClose }: { diff: DiffResult; onClose: () => void }) {
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

  const classes = diff.beforePlan && diff.afterPlan ? classify(diff) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Diff (before → after)</h2>
        <span className="text-sm" style={{ color: slower ? "var(--sev-error)" : "var(--sev-info)" }}>{headline}</span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onClose}>Close</Button>
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

      {classes && diff.beforePlan && diff.afterPlan && (
        <div className="pt-3">
          <div className="text-sm font-medium mb-2">Plans side by side</div>
          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                ["Before", diff.beforePlan, "before"],
                ["After", diff.afterPlan, "after"],
              ] as const
            ).map(([title, plan, side]) => (
              <div key={side} className="rounded-lg border p-3 overflow-x-auto" style={{ background: "var(--card)" }}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
                <div className="font-mono text-sm">
                  <DiffTree node={plan} depth={0} classes={classes} side={side} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span style={{ color: CLASS_COLOR.regressed }}>■ slower</span>
            <span style={{ color: CLASS_COLOR.improved }}>■ faster</span>
            <span style={{ color: CLASS_COLOR.added }}>■ added</span>
            <span className="line-through">■ removed</span>
          </div>
        </div>
      )}
    </div>
  );
}
