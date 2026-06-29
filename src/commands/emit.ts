import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisResult, Severity } from "../core/model.ts";
import { severityAtLeast } from "../diagnostics/diagnostic.ts";
import { type Format, render } from "../report/render.ts";
import { configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";
import { logInfo } from "../util/log.ts";
import { openInBrowser } from "../util/open.ts";

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
  /** Open an HTML report in the browser after writing it. */
  openHtml?: boolean;
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
    if (opts.format === "html" && opts.openHtml) openInBrowser(opts.output);
  } else if (opts.format === "html" && opts.openHtml) {
    // No --output but auto-open requested: stash in a temp file and open it,
    // rather than dumping raw HTML to an interactive terminal.
    const file = join(tmpdir(), `pg-explain-${Date.now()}.html`);
    await writeFile(file, text);
    logInfo(`Opened HTML report: ${file}`);
    openInBrowser(file);
  } else {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  return gateExit(result, opts.failOn);
}

function gateExit(result: AnalysisResult, failOn?: Severity): ExitCode {
  if (!failOn || result.worstSeverity === null) return ExitCode.Success;
  return severityAtLeast(result.worstSeverity, failOn) ? ExitCode.CiGate : ExitCode.Success;
}
