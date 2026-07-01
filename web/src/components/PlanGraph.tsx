import { Button } from "@/components/ui/button";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import type { PlanNode } from "../lib/api.ts";
import { collectHeat, HEAT_MODES, type HeatMode, heatPercent, numberToColorHsl } from "../lib/heat.ts";
import { nodeTitle } from "./NodeDetail.tsx";

const NODE_W = 234;
const NODE_H = 84;

interface FlowData extends Record<string, unknown> {
  node: PlanNode;
  heatPct: number;
  heatMode: HeatMode;
  selected: boolean;
}
type PlanFlowNode = Node<FlowData, "plan">;

function PlanNodeCard({ data }: NodeProps<PlanFlowNode>) {
  const { node, heatPct, heatMode, selected } = data;
  const m = node.metrics;
  const never = node.actualLoops === 0;
  const rel = node.parentRelationship;
  const badge = node.subplanName ?? (rel === "InitPlan" || rel === "SubPlan" ? rel : undefined);
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-xs shadow-sm ${selected ? "ring-2 ring-[var(--sev-info)]" : ""} ${never ? "opacity-60" : ""}`}
      style={{ width: NODE_W, background: "var(--card)", color: "var(--foreground)" }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="font-medium truncate" title={nodeTitle(node)}>
        {node.nodeType}
        {(node.workersLaunched ?? 0) > 0 && <span className="ml-1 text-muted-foreground">×{(node.workersLaunched ?? 0) + 1}</span>}
      </div>
      {(node.relationName || node.indexName) && (
        <div className="text-muted-foreground truncate">
          {node.indexName ? `using ${node.indexName}` : ""}
          {node.relationName ? ` on ${node.relationName}` : ""}
        </div>
      )}
      <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
        {m.selfMs != null && <span>{m.selfMs.toFixed(1)} ms</span>}
        {m.totalRows != null && <span>{m.totalRows.toLocaleString()} rows</span>}
        {never && <span>never executed</span>}
        {m.estimateFactor != null && m.estimateFactor >= 10 && m.estimateDirection !== "accurate" && (
          <span style={{ color: "var(--sev-warn)" }}>{m.estimateFactor.toFixed(0)}× {m.estimateDirection}</span>
        )}
      </div>
      {badge && <div className="text-[10px] mt-0.5 italic text-muted-foreground truncate">{badge}</div>}
      {heatMode !== "none" && (
        <div className="h-1 rounded mt-1" style={{ width: `${Math.max(3, heatPct)}%`, background: numberToColorHsl(heatPct) }} />
      )}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { plan: PlanNodeCard };

function buildGraph(root: PlanNode, heatMode: HeatMode, selectedId?: number) {
  const { values, max } = collectHeat(root);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 26, ranksep: 44 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodes: PlanFlowNode[] = [];
  const edges: { id: string; source: string; target: string; style?: Record<string, string> }[] = [];

  const walk = (n: PlanNode, parent?: PlanNode) => {
    g.setNode(String(n.id), { width: NODE_W, height: NODE_H });
    nodes.push({
      id: String(n.id),
      type: "plan",
      position: { x: 0, y: 0 },
      data: {
        node: n,
        heatMode,
        heatPct: heatPercent(n.id, heatMode, values, max),
        selected: selectedId === n.id,
      },
    });
    if (parent) {
      g.setEdge(String(parent.id), String(n.id));
      const sub = n.parentRelationship === "InitPlan" || n.parentRelationship === "SubPlan";
      edges.push({
        id: `${parent.id}-${n.id}`,
        source: String(parent.id),
        target: String(n.id),
        style: sub ? { strokeDasharray: "4 3", stroke: "var(--muted-foreground)" } : undefined,
      });
    }
    n.children.forEach((c) => walk(c, n));
  };
  walk(root);

  dagre.layout(g);
  for (const node of nodes) {
    const p = g.node(node.id);
    node.position = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }
  return { nodes, edges };
}

export function PlanGraph({
  root,
  onSelect,
  selectedId,
}: {
  root: PlanNode;
  onSelect: (n: PlanNode) => void;
  selectedId?: number;
}) {
  const [heat, setHeat] = useState<HeatMode>("duration");
  const { nodes, edges } = useMemo(() => buildGraph(root, heat, selectedId), [root, heat, selectedId]);

  return (
    <div className="relative h-[600px] rounded-md border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        onNodeClick={(_, n) => onSelect((n.data as FlowData).node)}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <div className="absolute top-2 right-2 z-10 flex gap-1 rounded-md p-1" style={{ background: "color-mix(in oklch, var(--card) 85%, transparent)" }}>
        {HEAT_MODES.map((h) => (
          <Button
            key={h.id}
            variant={heat === h.id ? "default" : "secondary"}
            size="sm"
            onClick={() => setHeat(h.id)}
          >
            {h.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
