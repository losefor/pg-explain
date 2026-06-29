import type { StartOptions, StudioServer } from "../server/start.ts";
import { ExitCode } from "../util/exit.ts";
import { logInfo } from "../util/log.ts";
import { openInBrowser } from "../util/open.ts";

export interface StudioArgs {
  host: string;
  port: number;
  open: boolean;
  /** Allow binding a non-loopback host (SSRF/credential risk). */
  unsafeHost: boolean;
}

type ServerModule = { startStudio: (opts: StartOptions) => Promise<StudioServer> };

/** `pg-explain studio` — start the local Studio web app and (optionally) open it. */
export async function runStudio(args: StudioArgs): Promise<ExitCode> {
  const loopback = args.host === "127.0.0.1" || args.host === "localhost" || args.host === "::1";
  if (!loopback && !args.unsafeHost) {
    logInfo(
      `Refusing to bind ${args.host}: the studio can connect to arbitrary databases, so exposing it off-loopback is an SSRF/credential risk. Pass --unsafe-host to override.`,
    );
    return ExitCode.Usage;
  }

  // Dynamic URL import keeps the server bundle (hono + better-sqlite3) out of the
  // CLI bundle, so plain CLI use never loads it and a broken native module can't
  // break `pg-explain analyze`.
  const mod = (await import(new URL("./server.js", import.meta.url).href)) as ServerModule;
  const server = await mod.startStudio({ host: args.host, port: args.port });

  logInfo(`\n  pgexplain studio  ${server.url}\n  Press Ctrl-C to stop.\n`);
  if (args.open) openInBrowser(server.url);

  // Take over signal handling for a clean shutdown (replaces the CLI's abrupt exit).
  process.removeAllListeners("SIGINT");
  process.removeAllListeners("SIGTERM");
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      logInfo("\nShutting down…");
      server.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return ExitCode.Success;
}
