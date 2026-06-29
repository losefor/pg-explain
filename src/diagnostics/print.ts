import type { Diagnostic } from "../core/model.ts";
import { colors } from "../util/color.ts";
import { scrubCredentials } from "./diagnostic.ts";

/**
 * Format a single diagnostic for stderr (fatal operational errors). Always tells the
 * user what/why/how, with copy-pasteable commands. Credentials are scrubbed last.
 */
export function formatDiagnostic(d: Diagnostic): string {
  const c = colors();
  const tag =
    d.severity === "error"
      ? c.red(c.bold("error"))
      : d.severity === "warn"
        ? c.yellow("warning")
        : c.cyan("info");

  const lines: string[] = [];
  lines.push(`${tag} ${c.bold(d.title)} ${c.dim(`[${d.code}]`)}`);
  lines.push(`  ${c.dim("what:")} ${d.detail}`);
  lines.push(`  ${c.dim("why: ")} ${d.cause}`);
  lines.push(`  ${c.dim("fix: ")} ${d.remediation.summary}`);
  for (const step of d.remediation.steps ?? []) lines.push(`        • ${step}`);
  for (const cmd of d.remediation.commands ?? []) {
    const body = cmd.sql ?? cmd.shell ?? "";
    const label = cmd.label ? `${c.dim(`${cmd.label}:`)} ` : "";
    lines.push(`        ${label}${c.green(body)}`);
  }
  if (d.docsUrl) lines.push(`        ${c.dim(`docs: ${d.docsUrl}`)}`);

  return scrubCredentials(lines.join("\n"));
}
