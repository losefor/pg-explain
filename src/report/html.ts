import { executionMs } from "../core/metrics.ts";
import type { AnalysisResult, Diagnostic, Severity } from "../core/model.ts";
import { fmtMs, UNICODE_TREE } from "../util/format.ts";
import { nodeLabel, nodeSummary, treeLines } from "./tree.ts";

const SEV: Record<Severity, { label: string; cls: string }> = {
  error: { label: "Critical", cls: "sev-error" },
  warn: { label: "Warning", cls: "sev-warn" },
  info: { label: "Note", cls: "sev-info" },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A single self-contained HTML file: inline CSS, no external assets, safe to email. */
export function renderHtml(result: AnalysisResult): string {
  const { tree, diagnostics } = result;
  const ms = executionMs(tree);

  const treeHtml = treeLines(tree, UNICODE_TREE)
    .map(({ node, prefix }) => {
      const pct = node.metrics.pctOfTotal ?? 0;
      const heat = pct >= 50 ? "hot" : pct >= 20 ? "warm" : pct >= 5 ? "" : "cold";
      return `<div class="node ${heat}"><span class="glyph">${esc(prefix)}</span><span class="label">${esc(nodeLabel(node))}</span> <span class="meta">${esc(nodeSummary(node))}</span></div>`;
    })
    .join("\n");

  const findingsHtml = diagnostics.length
    ? diagnostics.map(findingHtml).join("\n")
    : '<p class="ok">No anti-patterns detected. 🎉</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pg-explain report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 980px; margin-inline: auto; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #8884; padding-bottom: .3rem; }
  .verdict { padding: .75rem 1rem; border-left: 4px solid #888; background: #8881; border-radius: 4px; }
  .verdict.sev-error { border-color: #e5484d; } .verdict.sev-warn { border-color: #f5a623; } .verdict.sev-info { border-color: #4493f8; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: .3rem .6rem; border-bottom: 1px solid #8883; }
  .tree { overflow-x: auto; } .node { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; font-size: 13px; }
  .glyph { color: #8888; } .meta { color: #888; }
  .node.hot .label { color: #e5484d; font-weight: 700; } .node.warm .label { color: #f5a623; } .node.cold .label { opacity: .6; }
  .finding { border: 1px solid #8883; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
  .finding .tag { font-size: .75rem; font-weight: 700; padding: .1rem .5rem; border-radius: 3px; color: #fff; }
  .sev-error .tag { background: #e5484d; } .sev-warn .tag { background: #f5a623; } .sev-info .tag { background: #4493f8; }
  .finding code, pre { font-family: ui-monospace, monospace; font-size: 13px; }
  pre { background: #8881; padding: .6rem .8rem; border-radius: 4px; overflow-x: auto; }
  .label-cmd { color: #888; font-size: .85rem; margin-top: .5rem; }
  .ok { color: #2e7d32; }
</style>
</head>
<body>
<h1>pg-explain report</h1>
<div class="verdict ${result.worstSeverity ? SEV[result.worstSeverity].cls : ""}">${esc(result.verdict)}</div>

<h2>Summary</h2>
<table>
  ${tree.planningTime !== undefined ? `<tr><th>Planning time</th><td>${esc(fmtMs(tree.planningTime))}</td></tr>` : ""}
  ${ms !== undefined ? `<tr><th>Execution time</th><td>${esc(fmtMs(ms))}</td></tr>` : ""}
  ${!tree.hasAnalyze ? "<tr><th>Mode</th><td>cost-only (no ANALYZE)</td></tr>" : ""}
  <tr><th>Findings</th><td>${diagnostics.length}</td></tr>
</table>

<h2>Plan tree</h2>
<div class="tree">
${treeHtml}
</div>

<h2>Findings</h2>
${findingsHtml}
</body>
</html>
`;
}

function findingHtml(d: Diagnostic): string {
  const sev = SEV[d.severity];
  const steps = d.remediation.steps?.length
    ? `<ul>${d.remediation.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : "";
  const cmds = (d.remediation.commands ?? [])
    .map((c) => {
      const body = c.sql ?? c.shell ?? "";
      const label = c.label ? `<div class="label-cmd">${esc(c.label)}</div>` : "";
      return `${label}<pre><code>${esc(body)}</code></pre>`;
    })
    .join("");
  const docs = d.docsUrl ? `<p>📖 <a href="${esc(d.docsUrl)}">PostgreSQL docs</a></p>` : "";
  const meta = d.location?.relation
    ? ` <span class="meta">on ${esc(d.location.relation)}</span>`
    : "";

  return `<div class="finding ${sev.cls}">
  <p><span class="tag">${sev.label}</span> <strong>${esc(d.title)}</strong> <code>${esc(d.code)}</code>${meta}</p>
  <p><strong>What:</strong> ${esc(d.detail)}</p>
  <p><strong>Why:</strong> ${esc(d.cause)}</p>
  <p><strong>Fix:</strong> ${esc(d.remediation.summary)}</p>
  ${steps}
  ${cmds}
  ${docs}
</div>`;
}
