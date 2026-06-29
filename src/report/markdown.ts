import { executionMs } from "../core/metrics.ts";
import type { AnalysisResult, Diagnostic, Severity } from "../core/model.ts";
import { fmtInt, fmtMs, UNICODE_TREE } from "../util/format.ts";
import { nodeLabel, nodeSummary, treeLines } from "./tree.ts";

const SEV_LABEL: Record<Severity, string> = {
  error: "🔴 Critical",
  warn: "🟠 Warning",
  info: "🔵 Note",
};

export interface MarkdownOptions {
  tldr?: boolean;
}

/** The headline deliverable: a shareable Markdown report. */
export function renderMarkdown(result: AnalysisResult, opts: MarkdownOptions = {}): string {
  const { tree, diagnostics, bottlenecks } = result;
  const out: string[] = [];

  out.push("# pg-explain report", "");
  out.push(`> **Verdict:** ${result.verdict}`, "");

  // Summary.
  out.push("## Summary", "");
  const ms = executionMs(tree);
  out.push("| Metric | Value |", "| --- | --- |");
  if (tree.planningTime !== undefined) out.push(`| Planning time | ${fmtMs(tree.planningTime)} |`);
  if (ms !== undefined) out.push(`| Execution time | ${fmtMs(ms)} |`);
  if (!tree.hasAnalyze) out.push("| Mode | cost-only (no ANALYZE) |");
  out.push(`| Findings | ${summarizeCounts(diagnostics)} |`, "");

  if (opts.tldr) {
    out.push(...renderFindings(diagnostics, true));
    return `${out.join("\n").trimEnd()}\n`;
  }

  // Plan tree.
  out.push("## Plan tree", "", "```");
  for (const { node, prefix } of treeLines(tree, UNICODE_TREE)) {
    out.push(`${prefix}${nodeLabel(node)}  —  ${nodeSummary(node)}`);
  }
  out.push("```", "");

  // Bottlenecks.
  const ranked = bottlenecks.filter((n) => (n.metrics.selfMs ?? 0) > 0);
  if (ranked.length) {
    out.push("## Bottlenecks (by self time)", "");
    out.push("| # | Node | Self time | % of total | Rows |", "| --- | --- | --- | --- | --- |");
    ranked.forEach((node, i) => {
      const pct =
        node.metrics.pctOfTotal !== undefined ? `${node.metrics.pctOfTotal.toFixed(1)}%` : "—";
      const rows = node.metrics.totalRows !== undefined ? fmtInt(node.metrics.totalRows) : "—";
      out.push(
        `| ${i + 1} | ${nodeLabel(node)} | ${fmtMs(node.metrics.selfMs ?? 0)} | ${pct} | ${rows} |`,
      );
    });
    out.push("");
  }

  // Findings.
  out.push(...renderFindings(diagnostics, false));
  return `${out.join("\n").trimEnd()}\n`;
}

function renderFindings(diagnostics: Diagnostic[], tldr: boolean): string[] {
  const out: string[] = ["## Findings", ""];
  if (diagnostics.length === 0) {
    out.push("No anti-patterns detected. 🎉", "");
    return out;
  }

  for (const d of diagnostics) {
    out.push(`### ${SEV_LABEL[d.severity]} — ${d.title}`, "");
    out.push(`\`${d.code}\``, "");
    out.push(`**What:** ${d.detail}`, "");
    out.push(`**Why:** ${d.cause}`, "");
    out.push(`**Fix:** ${d.remediation.summary}`, "");
    if (!tldr) {
      if (d.remediation.steps?.length) {
        for (const step of d.remediation.steps) out.push(`- ${step}`);
        out.push("");
      }
      for (const cmd of d.remediation.commands ?? []) {
        const body = cmd.sql ?? cmd.shell ?? "";
        const lang = cmd.sql ? "sql" : "sh";
        if (cmd.label) out.push(`_${cmd.label}:_`);
        out.push("```" + lang, body, "```", "");
      }
      if (d.docsUrl) out.push(`📖 [PostgreSQL docs](${d.docsUrl})`, "");
    }
  }
  return out;
}

function summarizeCounts(diagnostics: Diagnostic[]): string {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  if (diagnostics.length === 0) return "none";
  return `${counts.error} critical, ${counts.warn} warning(s), ${counts.info} note(s)`;
}
