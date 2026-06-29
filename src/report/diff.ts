import type { DiffResult, SignatureDelta } from "../core/diff.ts";
import { colors } from "../util/color.ts";
import { fmtMs } from "../util/format.ts";

export type DiffFormat = "terminal" | "markdown" | "json";

export function renderDiff(diff: DiffResult, format: DiffFormat): string {
  if (format === "json") return JSON.stringify(diff, null, 2);
  if (format === "markdown") return renderDiffMarkdown(diff);
  return renderDiffTerminal(diff);
}

function headline(diff: DiffResult): string {
  if (diff.execDeltaMs === undefined)
    return "Compared plans (no timing available — using cost as a proxy).";
  const dir = diff.execDeltaMs > 0 ? "slower" : diff.execDeltaMs < 0 ? "faster" : "unchanged";
  const pct =
    diff.execDeltaPct !== undefined
      ? ` (${diff.execDeltaPct >= 0 ? "+" : ""}${diff.execDeltaPct.toFixed(1)}%)`
      : "";
  return `${fmtMs(Math.abs(diff.execDeltaMs))} ${dir}${pct}: ${fmtMs(diff.beforeMs ?? 0)} → ${fmtMs(diff.afterMs ?? 0)}`;
}

function renderDiffTerminal(diff: DiffResult): string {
  const c = colors();
  const out: string[] = [];
  out.push(c.bold("pg-explain diff (before → after)"));
  const slower = (diff.execDeltaMs ?? 0) > 0;
  out.push(`${c.bold("Verdict:")} ${slower ? c.red(headline(diff)) : c.green(headline(diff))}`);
  out.push("");

  section(out, "Regressed nodes (slower)", diff.regressed, (d) => c.red(deltaLine(d)));
  section(out, "Improved nodes (faster)", diff.improved, (d) => c.green(deltaLine(d)));
  section(out, "Added nodes", diff.added, (d) => `${d.signature}  +${fmtMs(d.afterMs)}`);
  section(out, "Removed nodes", diff.removed, (d) => `${d.signature}  -${fmtMs(d.beforeMs)}`);

  if (diff.newFindings.length) {
    out.push(c.bold(c.red("New findings")));
    for (const f of diff.newFindings) out.push(`  + [${f.severity}] ${f.title} ${c.dim(f.code)}`);
    out.push("");
  }
  if (diff.resolvedFindings.length) {
    out.push(c.bold(c.green("Resolved findings")));
    for (const f of diff.resolvedFindings) out.push(`  - ${f.title} ${c.dim(f.code)}`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function section(
  out: string[],
  title: string,
  items: SignatureDelta[],
  line: (d: SignatureDelta) => string,
): void {
  if (!items.length) return;
  out.push(colors().bold(title));
  for (const d of items.slice(0, 10)) out.push(`  ${line(d)}`);
  out.push("");
}

function deltaLine(d: SignatureDelta): string {
  const pct =
    d.deltaPct !== null ? ` (${d.deltaPct >= 0 ? "+" : ""}${d.deltaPct.toFixed(0)}%)` : "";
  const sign = d.deltaMs >= 0 ? "+" : "-";
  return `${d.signature}  ${sign}${fmtMs(Math.abs(d.deltaMs))}${pct}  [${fmtMs(d.beforeMs)} → ${fmtMs(d.afterMs)}]`;
}

function renderDiffMarkdown(diff: DiffResult): string {
  const out: string[] = ["# pg-explain diff", "", `> **${headline(diff)}**`, ""];

  const table = (title: string, items: SignatureDelta[]) => {
    if (!items.length) return;
    out.push(`## ${title}`, "", "| Node | Before | After | Δ |", "| --- | --- | --- | --- |");
    for (const d of items.slice(0, 20)) {
      const pct =
        d.deltaPct !== null ? ` (${d.deltaPct >= 0 ? "+" : ""}${d.deltaPct.toFixed(0)}%)` : "";
      out.push(
        `| ${d.signature} | ${fmtMs(d.beforeMs)} | ${fmtMs(d.afterMs)} | ${d.deltaMs >= 0 ? "+" : ""}${fmtMs(d.deltaMs)}${pct} |`,
      );
    }
    out.push("");
  };

  table("Regressed (slower)", diff.regressed);
  table("Improved (faster)", diff.improved);
  table("Added", diff.added);
  table("Removed", diff.removed);

  if (diff.newFindings.length) {
    out.push("## New findings", "");
    for (const f of diff.newFindings) out.push(`- **${f.severity}** ${f.title} \`${f.code}\``);
    out.push("");
  }
  if (diff.resolvedFindings.length) {
    out.push("## Resolved findings", "");
    for (const f of diff.resolvedFindings) out.push(`- ${f.title} \`${f.code}\``);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
