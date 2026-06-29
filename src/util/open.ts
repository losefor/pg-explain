import { spawn } from "node:child_process";

/** The OS command that opens a file/URL with the default app. */
export function browserCommand(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  return "xdg-open"; // linux / bsd
}

/**
 * Open a file in the default browser. Best-effort and non-fatal: a missing opener
 * (e.g. headless Linux) is swallowed so the command still succeeds. Detached so we
 * don't block on the browser process.
 */
export function openInBrowser(target: string, platform: NodeJS.Platform = process.platform): void {
  const cmd = browserCommand(platform);
  try {
    const child = spawn(cmd, [target], {
      stdio: "ignore",
      detached: true,
      shell: platform === "win32", // `start` is a shell builtin
    });
    child.on("error", () => {}); // opener not found → ignore
    child.unref();
  } catch {
    // never let opening a report fail the command
  }
}
