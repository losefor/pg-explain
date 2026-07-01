import { writeFile } from "node:fs/promises";
import type { ConnectionOptions } from "../db/client.ts";
import { type LiveLocks, liveLocks } from "../locks/live.ts";
import { colors, configureColor } from "../util/color.ts";
import { ExitCode } from "../util/exit.ts";

export interface LocksArgs {
  connection: ConnectionOptions;
  format: "terminal" | "json";
  output?: string;
  color: "auto" | "always" | "never";
  /** CI gate: exit 1 when any session is blocked. */
  failOnBlocked?: boolean;
}

/** locks command: snapshot who blocks whom right now (pg_stat_activity + pg_blocking_pids). */
export async function runLocks(args: LocksArgs): Promise<ExitCode> {
  const snapshot = await liveLocks(args.connection, Date.now());

  configureColor(args.format === "terminal" ? args.color : "never");
  const text =
    args.format === "json" ? `${JSON.stringify(snapshot, null, 2)}\n` : renderLocks(snapshot);

  if (args.output) await writeFile(args.output, text);
  else process.stdout.write(text);

  return args.failOnBlocked && snapshot.blocked.length > 0 ? ExitCode.CiGate : ExitCode.Success;
}

/** Exported for tests. */
export function renderLocks(live: LiveLocks): string {
  const c = colors();
  const out: string[] = [
    c.bold("Live locks"),
    c.dim(`${live.sessions.length} client session(s) · ${live.blocked.length} blocked`),
    "",
  ];

  if (live.blocked.length === 0) {
    out.push("No lock contention right now — nothing is waiting on another session.");
    return `${out.join("\n")}\n`;
  }

  for (const s of live.blocked) {
    const age = s.ageSeconds != null ? ` · waiting ${s.ageSeconds.toFixed(0)}s` : "";
    const wait = s.waitEvent ? ` · ${s.waitEventType ?? "?"}/${s.waitEvent}` : "";
    out.push(
      `${c.yellow("⚠")} pid ${c.bold(String(s.pid))} (${s.user ?? "?"}) blocked by pid ${s.blockedBy.join(", ")}${age}${wait}`,
    );
    if (s.query) out.push(c.dim(`  ${s.query.replace(/\s+/g, " ").slice(0, 200)}`));
    out.push(
      c.dim(
        `  inspect the blocker; cancel with SELECT pg_cancel_backend(${s.blockedBy[0]}); or terminate with pg_terminate_backend(…).`,
      ),
      "",
    );
  }
  return `${out.join("\n")}\n`;
}
