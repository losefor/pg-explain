import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../../src/core/model.ts";
import { OP_CODES, opDiagnostic } from "../../../src/diagnostics/catalog.ts";
import { formatDiagnostic } from "../../../src/diagnostics/print.ts";
import { configureColor } from "../../../src/util/color.ts";

configureColor("never");

describe("operational catalog completeness", () => {
  it("every code has the actionable fields the user requires", () => {
    expect(OP_CODES.length).toBeGreaterThan(15);
    for (const code of OP_CODES) {
      const d = opDiagnostic(code);
      expect(d.code, code).toBe(code);
      expect(d.title.trim().length, code).toBeGreaterThan(0);
      expect(d.detail.trim().length, code).toBeGreaterThan(0);
      expect(d.cause.trim().length, code).toBeGreaterThan(0);
      // The load-bearing guarantee: remediation is never empty.
      expect(d.remediation.summary.trim().length, code).toBeGreaterThan(0);
    }
  });

  it("formats every code for stderr without throwing", () => {
    for (const code of OP_CODES) {
      const out = formatDiagnostic(opDiagnostic(code));
      expect(out, code).toContain(code);
      expect(out, code).toMatch(/fix:/);
    }
  });
});

describe("formatDiagnostic rendering", () => {
  const full: Diagnostic = {
    code: "PGX_DEMO",
    domain: "plan",
    severity: "warn",
    title: "Demo finding",
    detail: "what happened",
    cause: "why it matters",
    remediation: {
      summary: "do this",
      steps: ["step one", "step two"],
      commands: [{ label: "run", shell: "echo hi" }, { sql: "VACUUM t;" }],
    },
    docsUrl: "https://www.postgresql.org/docs/current/sql-vacuum.html",
  };

  it("includes steps, commands, and docs", () => {
    const out = formatDiagnostic(full);
    expect(out).toContain("step one");
    expect(out).toContain("echo hi");
    expect(out).toContain("VACUUM t;");
    expect(out).toContain("docs:");
  });

  it("renders each severity tag", () => {
    for (const severity of ["error", "warn", "info"] as const) {
      expect(formatDiagnostic({ ...full, severity })).toContain("Demo finding");
    }
  });

  it("scrubs credentials from the rendered output", () => {
    const leaky: Diagnostic = { ...full, detail: "postgres://u:secret@h:5432/db failed" };
    expect(formatDiagnostic(leaky)).not.toContain("secret");
  });
});
