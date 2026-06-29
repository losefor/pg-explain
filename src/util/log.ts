/**
 * Diagnostics and progress go to stderr; report output goes to stdout. This keeps
 * `pg-explain ... > report.md` and `... | jq` clean. Nothing here ever touches stdout.
 */
export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

let level: LogLevel = "normal";

export function setLogLevel(l: LogLevel): void {
  level = l;
}

export function isDebug(): boolean {
  return level === "debug";
}

function write(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** Normal informational output (suppressed by --quiet). */
export function logInfo(msg: string): void {
  if (level !== "quiet") write(msg);
}

/** Extra detail (only with --verbose/--debug). */
export function logVerbose(msg: string): void {
  if (level === "verbose" || level === "debug") write(msg);
}

/** Errors are always shown, even under --quiet. */
export function logError(msg: string): void {
  write(msg);
}
