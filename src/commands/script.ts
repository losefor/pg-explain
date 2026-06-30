import { writeFile } from "node:fs/promises";
import type { PgExplainConfig } from "../config.ts";
import type { AnalysisResult, Severity } from "../core/model.ts";
import { type ConnectionOptions, explainScript } from "../db/client.ts";
import { severityAtLeast } from "../diagnostics/diagnostic.ts";
import { analyze } from "../index.ts";
import { buildReport } from "../report/json.ts";
import { type Format, render } from "../report/render.ts";
import { extractAnalyzableUnits } from "../sql/extract.ts";
import { colors, configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";

export interface ScriptUnitReport {
  label: string;
  status: "analyzed" | "skipped" | "error";
  loopNote?: string;
  result?: AnalysisResult;
  report?: Record<string, unknown>;
  reason?: string;
  errorCode?: string;
}

export interface ScriptAnalysis {
  /** Always false — this path is cost-only and never executes anything. */
  executed: false;
  serverMajor?: number;
  units: ScriptUnitReport[];
}

export interface ScriptOptions {
  config: PgExplainConfig;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  verbose?: boolean;
  settings?: boolean;
  redact?: boolean;
}

/** Extract analyzable statements from arbitrary SQL and cost-only EXPLAIN each (never executes). */
export async function analyzeScript(
  connection: ConnectionOptions,
  sql: string,
  opts: ScriptOptions,
): Promise<ScriptAnalysis> {
  const units = extractAnalyzableUnits(sql);
  const explainable = units.filter((u) => u.kind === "explainable");

  const exec = explainable.length
    ? await explainScript(
        connection,
        explainable.map((u) => ({
          label: u.label,
          sql: u.sql,
          ...(u.loopNote ? { loopNote: u.loopNote } : {}),
        })),
        {
          statementTimeoutMs: opts.statementTimeoutMs,
          lockTimeoutMs: opts.lockTimeoutMs,
          verbose: opts.verbose,
          settings: opts.settings,
        },
      )
    : null;

  let ei = 0;
  const out: ScriptUnitReport[] = units.map((u) => {
    if (u.kind === "skipped") return { label: u.label, status: "skipped", reason: u.reason };
    const r = exec?.units[ei++];
    if (!r) return { label: u.label, status: "skipped", reason: "not analyzed" };
    if (r.error) {
      return {
        label: u.label,
        status: "error",
        reason: r.error.detail,
        errorCode: r.error.code,
        ...(r.loopNote ? { loopNote: r.loopNote } : {}),
      };
    }
    const result = analyze(r.planJson as string, {
      sql: u.sql,
      config: opts.config,
      redact: opts.redact,
    });
    return {
      label: u.label,
      status: "analyzed",
      result,
      report: buildReport(result),
      ...(r.loopNote ? { loopNote: r.loopNote } : {}),
    };
  });

  return { executed: false, units: out, ...(exec ? { serverMajor: exec.caps.major } : {}) };
}

export interface EmitScriptOptions {
  format: Format;
  output?: string;
  color: "auto" | "always" | "never";
  ascii?: boolean;
  tldr?: boolean;
  pretty?: boolean;
  failOn?: Severity;
}

/** Render a multi-unit cost-only analysis and return the CI-gate exit code. */
export async function emitScript(
  analysis: ScriptAnalysis,
  opts: EmitScriptOptions,
): Promise<ExitCode> {
  configureColor(opts.format === "terminal" ? opts.color : "never");
  const text =
    opts.format === "json"
      ? renderJsonScript(analysis, opts.pretty ?? true)
      : renderTextScript(analysis, opts);

  if (opts.output) await writeFile(opts.output, text);
  else process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

  // CI gate: worst severity across analyzed units.
  if (opts.failOn) {
    for (const u of analysis.units) {
      if (u.result?.worstSeverity && severityAtLeast(u.result.worstSeverity, opts.failOn))
        return ExitCode.CiGate;
    }
  }
  return ExitCode.Success;
}

function renderJsonScript(analysis: ScriptAnalysis, pretty: boolean): string {
  const units = analysis.units.map((u) => ({
    label: u.label,
    status: u.status,
    loopNote: u.loopNote ?? null,
    report: u.report ?? null,
    reason: u.reason ?? null,
    errorCode: u.errorCode ?? null,
  }));
  return JSON.stringify(
    { executed: false, serverMajor: analysis.serverMajor ?? null, units },
    null,
    pretty ? 2 : 0,
  );
}

function renderTextScript(analysis: ScriptAnalysis, opts: EmitScriptOptions): string {
  const c = colors();
  const analyzed = analysis.units.filter((u) => u.status === "analyzed").length;
  const skipped = analysis.units.length - analyzed;
  const out: string[] = [];
  out.push(
    c.bold("Cost-only analysis — nothing was executed.") +
      c.dim(` ${analyzed} analyzed, ${skipped} skipped/failed.`),
  );
  out.push("");

  for (const u of analysis.units) {
    out.push(c.bold(`▸ ${u.label}`) + (u.loopNote ? c.dim(`  (${u.loopNote})`) : ""));
    if (u.status === "analyzed" && u.result) {
      out.push(render(u.result, { format: opts.format, tldr: opts.tldr, ascii: opts.ascii }));
    } else {
      const tag = u.status === "error" ? c.yellow("could not analyze") : c.dim("skipped");
      out.push(
        `  ${tag}: ${u.reason ?? "(no detail)"}${u.errorCode ? c.dim(` [${u.errorCode}]`) : ""}`,
      );
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
