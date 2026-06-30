import { json } from "@codemirror/lang-json";
import { PostgreSQL, type SQLNamespace, sql } from "@codemirror/lang-sql";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { editorThemeExtensions } from "../lib/editorTheme.ts";

export interface CodeEditorHandle {
  insertText: (text: string) => void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  language: "sql" | "json";
  /** Autocomplete map: { "table": [cols], "schema.table": [cols] }. */
  schema?: Record<string, string[]>;
  /** Inline error to underline (0-based offset into the document). */
  error?: { offset: number; message: string } | null;
  placeholder?: string;
  minHeight?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, onRun, language, schema, error, placeholder, minHeight = "120px" },
  ref,
) {
  const cm = useRef<ReactCodeMirrorRef>(null);

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const view = cm.current?.view;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
  }));

  const extensions = useMemo(() => {
    const lang =
      language === "sql"
        ? sql({
            dialect: PostgreSQL,
            schema: schema as SQLNamespace | undefined,
            defaultSchema: "public",
            upperCaseKeywords: false,
          })
        : json();
    const runKeymap = keymap.of([
      {
        key: "Mod-Enter",
        preventDefault: true,
        run: () => {
          onRun?.();
          return true;
        },
      },
    ]);
    return [lang, runKeymap, lintGutter(), EditorView.lineWrapping, ...editorThemeExtensions];
  }, [language, schema, onRun]);

  // Push the inline error as a CodeMirror diagnostic whenever it (or the text) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on value to re-anchor after edits.
  useEffect(() => {
    const view = cm.current?.view;
    if (!view) return;
    const len = view.state.doc.length;
    const diagnostics: CmDiagnostic[] =
      error && len > 0
        ? [
            {
              from: Math.min(Math.max(error.offset, 0), len - 1),
              to: Math.min(error.offset + 1, len),
              severity: "error",
              message: error.message,
            },
          ]
        : [];
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [error, value]);

  return (
    <CodeMirror
      ref={cm}
      value={value}
      onChange={onChange}
      extensions={extensions}
      placeholder={placeholder}
      minHeight={minHeight}
      theme="none"
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightActiveLine: true,
        foldGutter: false,
      }}
    />
  );
});
