import { describe, expect, it } from "vitest";
import { opDiagnostic, opError } from "../../../src/diagnostics/catalog.ts";
import { scrubCredentials } from "../../../src/diagnostics/diagnostic.ts";
import { ExitCode } from "../../../src/util/exit.ts";

describe("scrubCredentials", () => {
  it("removes passwords from connection URLs", () => {
    expect(scrubCredentials("postgres://app:s3cret@db:5432/shop")).toBe(
      "postgres://app:***@db:5432/shop",
    );
  });
  it("removes libpq and PG* passwords", () => {
    expect(scrubCredentials("host=db password=s3cret sslmode=require")).toContain("password=***");
    expect(scrubCredentials("PGPASSWORD=hunter2")).toBe("PGPASSWORD=***");
  });
  it("leaves credential-free text untouched", () => {
    expect(scrubCredentials("connection refused")).toBe("connection refused");
  });
});

describe("operational catalog", () => {
  it("every code carries non-empty remediation", () => {
    for (const code of [
      "PGX_AUTH_FAILED",
      "PGX_STATEMENT_TIMEOUT",
      "PGX_MALFORMED_JSON",
    ] as const) {
      const d = opDiagnostic(code);
      expect(d.remediation.summary.length).toBeGreaterThan(0);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.cause.length).toBeGreaterThan(0);
    }
  });

  it("maps codes to the documented exit codes", () => {
    expect(opError("PGX_AUTH_FAILED").exitCode).toBe(ExitCode.Database);
    expect(opError("PGX_MALFORMED_JSON").exitCode).toBe(ExitCode.Parse);
    expect(opError("PGX_EMPTY_INPUT").exitCode).toBe(ExitCode.Input);
    expect(opError("PGX_NON_SELECT_REFUSED").exitCode).toBe(ExitCode.Usage);
    expect(opError("PGX_INTERNAL").exitCode).toBe(ExitCode.Internal);
  });

  it("supports a detail override for situation-specifics", () => {
    const d = opDiagnostic("PGX_AUTH_FAILED", { detail: "user 'app' on 'shop'" });
    expect(d.detail).toBe("user 'app' on 'shop'");
  });
});
