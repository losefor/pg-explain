import { writeFile } from "node:fs/promises";
import type { AnalysisResult, Severity } from "../core/model.ts";
import { severityAtLeast } from "../diagnostics/diagnostic.ts";
import { type Format, render } from "../report/render.ts";
import { configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";

export interface EmitOptions {
  format: Format;
  /** Write to this file instead of stdout. */
  output?: string;
  color: "auto" | "always" | "never";
  ascii?: boolean;
  tldr?: boolean;
  pretty?: boolean;
  /** CI gate: exit non-zero if a finding at/above this severity exists. */
  failOn?: Severity;
}

/** Render the result, write it (stdout or --output), and return the CI-gate exit code. */
export async function emit(result: AnalysisResult, opts: EmitOptions): Promise<ExitCode> {
  // Color only ever applies to the terminal format; ANSI would corrupt md/json/html/text.
  configureColor(opts.format === "terminal" ? opts.color : "never");

  const text = render(result, {
    format: opts.format,
    tldr: opts.tldr,
    ascii: opts.ascii,
    pretty: opts.pretty,
  });

  if (opts.output) {
    await writeFile(opts.output, text);
  } else {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  return gateExit(result, opts.failOn);
}

function gateExit(result: AnalysisResult, failOn?: Severity): ExitCode {
  if (!failOn || result.worstSeverity === null) return ExitCode.Success;
  return severityAtLeast(result.worstSeverity, failOn) ? ExitCode.CiGate : ExitCode.Success;
}
