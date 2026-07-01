---
"pgexplain": patch
---

Studio & DX quality pass:

- Studio: toast notifications — export failures and settings saves are no longer silent
- Studio: keyboard shortcuts (⌘/Ctrl+K focus editor, ⇧⌘/Ctrl+F format SQL, `?` help overlay) and ARIA tablist/landmark roles
- Studio: collapsible sidebar and history filter box
- Library: export `severityAtLeast` for CI-gate scripting; README library examples expanded
- Tests: snapshot coverage for all five render formats, command-flow tests for `analyze`/`diff` exit codes, and a new `web` vitest project covering studio helpers
- Dev: `pnpm dev:studio` runs core rebuild + API restart + Vite HMR in one terminal
