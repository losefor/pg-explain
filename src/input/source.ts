import { readFile } from "node:fs/promises";
import { opError } from "../diagnostics/catalog.ts";
import { readStdin } from "./stdin.ts";

/**
 * Resolve plan text from --file or stdin. Fails with an actionable PGX_EMPTY_INPUT
 * when there is no input (including the interactive "ran it with no pipe" case).
 */
export async function resolvePlanInput(file?: string): Promise<string> {
  if (file) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw opError(
        "PGX_EMPTY_INPUT",
        { detail: `Could not read file '${file}': ${msg}`, location: { kind: "input" } },
        err,
      );
    }
    if (!text.trim()) {
      throw opError("PGX_EMPTY_INPUT", {
        detail: `File '${file}' is empty.`,
        location: { kind: "input" },
      });
    }
    return text;
  }

  if (process.stdin.isTTY) {
    throw opError("PGX_EMPTY_INPUT", {
      detail: "No --file given and stdin is a terminal (nothing was piped in).",
    });
  }

  const text = await readStdin();
  if (!text.trim()) throw opError("PGX_EMPTY_INPUT");
  return text;
}
