import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** CodeMirror theme bound to the app's shadcn CSS variables, so it follows light/dark automatically. */
const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--secondary)",
    color: "var(--foreground)",
    fontSize: "13px",
    borderRadius: "var(--radius-md, 8px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    padding: "10px 4px",
    caretColor: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--secondary)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklch, var(--primary) 30%, transparent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)",
    outline: "1px solid var(--border)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm, 6px)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  ".cm-lintRange-error": { textDecoration: "underline wavy var(--sev-error)" },
});

/** Token colors from the severity scale, so highlighting matches the report palette. */
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--sev-info)", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "var(--sev-warn)" },
  { tag: [t.number, t.bool, t.null], color: "var(--sev-warn)" },
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--sev-info)" },
  { tag: [t.typeName, t.className], color: "var(--sev-info)" },
  { tag: [t.operator, t.punctuation, t.separator], color: "var(--muted-foreground)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--foreground)" },
]);

export const editorThemeExtensions = [theme, syntaxHighlighting(highlight)];
