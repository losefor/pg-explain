import { executionMs } from "../core/metrics.ts";
import type { AnalysisResult, Diagnostic, PlanNode, Severity } from "../core/model.ts";
import { colors } from "../util/color.ts";
import { ASCII_TREE, fmtMs, UNICODE_TREE } from "../util/format.ts";
import { nodeLabel, nodeSummary, treeLines } from "./tree.ts";

export interface TerminalOptions {
  /** ASCII tree glyphs + no bars; suitable for logs / screen readers. */
  ascii?: boolean;
  bars?: boolean;
  tldr?: boolean;
}

const SEV_TAG: Record<Severity, string> = { error: "CRITICAL", warn: "WARNING", info: "NOTE" };

function sevColor(sev: Severity, text: string): string {
  const c = colors();
  if (sev === "error") return c.red(c.bold(text));
  if (sev === "warn") return c.yellow(text);
  return c.cyan(text);
}

/** Heat the node label by its share of total time. */
function heat(node: PlanNode, text: string): string {
  const c = colors();
  const pct = node.metrics.pctOfTotal;
  if (pct === undefined) return text;
  if (pct >= 50) return c.red(c.bold(text));
  if (pct >= 20) return c.yellow(text);
  if (pct >= 5) return text;
  return c.dim(text);
}

function bar(pct: number, width = 8): string {
  const filled = Math.round((pct / 100) * width);
  return "▇".repeat(Math.min(filled, width)) + "▁".repeat(Math.max(width - filled, 0));
}

export function renderTerminal(result: AnalysisResult, opts: TerminalOptions = {}): string {
  const c = colors();
  const { tree, diagnostics, bottlenecks } = result;
  const glyphs = opts.ascii ? ASCII_TREE : UNICODE_TREE;
  const out: string[] = [];

  out.push(c.bold("pg-explain report"));
  out.push(`${c.bold("Verdict:")} ${verdictColored(result)}`);
  out.push("");

  if (opts.tldr) {
    out.push(...findingsBlock(diagnostics, opts));
    return `${out.join("\n").trimEnd()}\n`;
  }

  // Plan tree.
  out.push(c.bold("Plan tree"));
  for (const { node, prefix } of treeLines(tree, glyphs)) {
    const heatBar =
      opts.bars !== false && node.metrics.pctOfTotal !== undefined
        ? ` ${c.dim(bar(node.metrics.pctOfTotal))}`
        : "";
    out.push(
      `${c.dim(prefix)}${heat(node, nodeLabel(node))}${heatBar}  ${c.dim(nodeSummary(node))}`,
    );
  }
  out.push("");

  // Bottlenecks.
  const ranked = bottlenecks.filter((n) => (n.metrics.selfMs ?? 0) > 0);
  if (ranked.length) {
    out.push(c.bold("Bottlenecks (by self time)"));
    ranked.forEach((node, i) => {
      const pct =
        node.metrics.pctOfTotal !== undefined ? `${node.metrics.pctOfTotal.toFixed(0)}%` : "—";
      out.push(
        `  ${i + 1}. ${heat(node, nodeLabel(node))} — ${fmtMs(node.metrics.selfMs ?? 0)} (${pct})`,
      );
    });
    out.push("");
  }

  out.push(...findingsBlock(diagnostics, opts));
  const ms = executionMs(tree);
  if (ms !== undefined) out.push(c.dim(`Total execution time: ${fmtMs(ms)}`));
  return `${out.join("\n").trimEnd()}\n`;
}

function verdictColored(result: AnalysisResult): string {
  if (result.worstSeverity === null) return colors().green(result.verdict);
  return sevColor(result.worstSeverity, result.verdict);
}

function findingsBlock(diagnostics: Diagnostic[], opts: TerminalOptions): string[] {
  const c = colors();
  const out: string[] = [c.bold("Findings")];
  if (diagnostics.length === 0) {
    out.push(`  ${c.green("No anti-patterns detected.")}`, "");
    return out;
  }
  for (const d of diagnostics) {
    out.push("");
    out.push(
      `${sevColor(d.severity, `[${SEV_TAG[d.severity]}]`)} ${c.bold(d.title)} ${c.dim(d.code)}`,
    );
    out.push(`  ${c.dim("What:")} ${d.detail}`);
    out.push(`  ${c.dim("Why: ")} ${d.cause}`);
    out.push(`  ${c.dim("Fix: ")} ${d.remediation.summary}`);
    if (!opts.tldr) {
      for (const step of d.remediation.steps ?? []) out.push(`        - ${step}`);
      for (const cmd of d.remediation.commands ?? []) {
        const body = cmd.sql ?? cmd.shell ?? "";
        const label = cmd.label ? `${c.dim(`${cmd.label}:`)} ` : "";
        out.push(`        ${label}${c.green(body)}`);
      }
      if (d.docsUrl) out.push(`        ${c.dim(`docs: ${d.docsUrl}`)}`);
    }
  }
  out.push("");
  return out;
}
