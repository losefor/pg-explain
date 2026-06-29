import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PgExplainConfig } from "../config.ts";
import type { AnalysisResult } from "../core/model.ts";
import { opError } from "../diagnostics/catalog.ts";
import { severityAtLeast } from "../diagnostics/diagnostic.ts";
import { analyze } from "../index.ts";
import { resolvePlanInput } from "../input/source.ts";
import { render } from "../report/render.ts";
import { configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";
import { type EmitOptions, emit } from "./emit.ts";

export interface AnalyzeArgs extends EmitOptions {
  file?: string;
  statement?: number;
  redact?: boolean;
  config: PgExplainConfig;
}

/** Default command: read a plan from --file/stdin (or a directory → batch), analyze, render. */
export async function runAnalyze(args: AnalyzeArgs): Promise<ExitCode> {
  if (args.file && (await isDirectory(args.file))) return runBatch(args, args.file);

  const text = await resolvePlanInput(args.file);
  const result = analyze(text, {
    config: args.config,
    statement: args.statement,
    redact: args.redact,
  });
  return emit(result, args);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Analyze every *.json plan file in a directory; one report each, worst gate wins. */
async function runBatch(args: AnalyzeArgs, dir: string): Promise<ExitCode> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    throw opError("PGX_EMPTY_INPUT", {
      detail: `No .json plan files found in directory '${dir}'.`,
    });
  }

  configureColor(args.format === "terminal" ? args.color : "never");

  const jsonReports: Array<{ file: string; report: unknown }> = [];
  const textReports: string[] = [];
  let worst: ExitCode = ExitCode.Success;

  for (const name of files) {
    const text = await readFile(join(dir, name), "utf8");
    let result: AnalysisResult;
    try {
      result = analyze(text, { config: args.config, redact: args.redact });
    } catch (err) {
      // One bad file shouldn't abort the whole batch.
      process.stderr.write(
        `skipping ${name}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      worst = ExitCode.Parse;
      continue;
    }

    if (gateTrips(result, args.failOn)) worst = ExitCode.CiGate;

    const body = render(result, {
      format: args.format,
      tldr: args.tldr,
      ascii: args.ascii,
      pretty: args.pretty,
    });
    if (args.format === "json") jsonReports.push({ file: name, report: JSON.parse(body) });
    else textReports.push(`\n${"=".repeat(60)}\n${name}\n${"=".repeat(60)}\n${body}`);
  }

  const out =
    args.format === "json"
      ? `${JSON.stringify(jsonReports, null, args.pretty ? 2 : 0)}\n`
      : `${textReports.join("\n")}\n`;
  if (args.output) await writeFile(args.output, out);
  else process.stdout.write(out);
  return worst;
}

function gateTrips(result: AnalysisResult, failOn?: EmitOptions["failOn"]): boolean {
  if (!failOn || result.worstSeverity === null) return false;
  return severityAtLeast(result.worstSeverity, failOn);
}
