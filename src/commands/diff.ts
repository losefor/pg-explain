import { readFile, writeFile } from "node:fs/promises";
import type { PgExplainConfig } from "../config.ts";
import { diffAnalyses } from "../core/diff.ts";
import { opError } from "../diagnostics/catalog.ts";
import { analyze } from "../index.ts";
import { type DiffFormat, renderDiff } from "../report/diff.ts";
import { configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";

export interface DiffArgs {
  before: string;
  after: string;
  format: DiffFormat;
  output?: string;
  color: "auto" | "always" | "never";
  redact?: boolean;
  config: PgExplainConfig;
  /** Exit 1 if execution time regressed by at least this percent. */
  failOnSlowerPct?: number;
  /** Exit 1 if any new finding appears. */
  failOnNewFindings?: boolean;
}

/** diff command: compare two plans and report what changed. */
export async function runDiff(args: DiffArgs): Promise<ExitCode> {
  const [beforeText, afterText] = await Promise.all([readPlan(args.before), readPlan(args.after)]);
  const before = analyze(beforeText, { config: args.config, redact: args.redact });
  const after = analyze(afterText, { config: args.config, redact: args.redact });
  const diff = diffAnalyses(before, after);

  configureColor(args.format === "terminal" ? args.color : "never");
  const text = renderDiff(diff, args.format);
  if (args.output) await writeFile(args.output, text);
  else process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);

  // CI gate.
  if (args.failOnNewFindings && diff.newFindings.length > 0) return ExitCode.CiGate;
  if (
    args.failOnSlowerPct !== undefined &&
    diff.execDeltaPct !== undefined &&
    diff.execDeltaPct >= args.failOnSlowerPct
  ) {
    return ExitCode.CiGate;
  }
  return ExitCode.Success;
}

async function readPlan(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw opError(
      "PGX_EMPTY_INPUT",
      {
        detail: `Could not read plan file '${path}': ${err instanceof Error ? err.message : String(err)}`,
      },
      err,
    );
  }
}
