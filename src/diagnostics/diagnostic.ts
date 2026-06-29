import type { Diagnostic, Remediation, Severity } from "../core/model.ts";
import type { ExitCode } from "../util/exit.ts";

/**
 * An error that carries a fully-actionable Diagnostic and a process exit code.
 * cli.ts catches these, renders the diagnostic to stderr, and exits with `exitCode`.
 * Anything NOT an AppError that reaches the top level becomes PGX_INTERNAL.
 */
export class AppError extends Error {
  readonly diagnostic: Diagnostic;
  readonly exitCode: ExitCode;

  constructor(diagnostic: Diagnostic, exitCode: ExitCode, cause?: unknown) {
    super(diagnostic.title);
    this.name = "AppError";
    this.diagnostic = diagnostic;
    this.exitCode = exitCode;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Convenience constructor for plan-domain findings (used by advisor rules). */
export function finding(
  code: string,
  severity: Severity,
  parts: {
    title: string;
    detail: string;
    cause: string;
    remediation: Remediation;
    docsUrl?: string;
    location?: Diagnostic["location"];
    meta?: Diagnostic["meta"];
  },
): Diagnostic {
  return { code, domain: "plan", severity, ...parts };
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Sort by severity (error first), keeping input order within a severity (stable). */
export function bySeverity(a: Diagnostic, b: Diagnostic): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

/** True when `s` is at least as severe as `threshold` (error ≥ warn ≥ info). */
export function severityAtLeast(s: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[s] <= SEVERITY_RANK[threshold];
}

/**
 * Remove secrets from any string before it is logged, shown, or written.
 * Targets:
 *  - userinfo passwords in connection URLs:  postgres://user:secret@host  → user:***@host
 *  - libpq keyword form:                     password=secret              → password=***
 *  - PG* env-style:                          PGPASSWORD=secret            → PGPASSWORD=***
 *  - URL query params:                        ?password=secret&sslmode=…  → ?password=***&…
 */
export function scrubCredentials(input: string): string {
  if (!input) return input;
  return input
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:/?#@\s]+:)([^@\s]+)(@)/gi, "$1***$3")
    .replace(/\bpassword\s*=\s*'[^']*'/gi, "password='***'")
    .replace(/(\bpassword\s*=\s*)([^\s&'"]+)/gi, "$1***")
    .replace(/(\bPGPASSWORD\s*=\s*)([^\s&'"]+)/gi, "$1***");
}
