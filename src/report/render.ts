import type { AnalysisResult } from "../core/model.ts";
import { renderHtml } from "./html.ts";
import { renderJson } from "./json.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderTerminal } from "./terminal.ts";

export type Format = "terminal" | "markdown" | "json" | "html" | "text";

export const FORMATS: Format[] = ["terminal", "markdown", "json", "html", "text"];

export function isFormat(s: string): s is Format {
  return (FORMATS as string[]).includes(s);
}

export interface RenderOptions {
  format: Format;
  /** Summary + findings only, no plan tree. */
  tldr?: boolean;
  /** ASCII tree glyphs (terminal/text). */
  ascii?: boolean;
  /** Pretty-print JSON. */
  pretty?: boolean;
}

/** Render an analysis result to the requested format. Color is configured by the caller. */
export function render(result: AnalysisResult, opts: RenderOptions): string {
  switch (opts.format) {
    case "markdown":
      return renderMarkdown(result, { tldr: opts.tldr });
    case "json":
      return renderJson(result, opts.pretty ?? true);
    case "html":
      return renderHtml(result);
    case "text":
      // Plain text: ASCII tree, no bars. Caller disables color for this format.
      return renderTerminal(result, { ascii: true, bars: false, tldr: opts.tldr });
    default:
      return renderTerminal(result, { ascii: opts.ascii, tldr: opts.tldr });
  }
}
