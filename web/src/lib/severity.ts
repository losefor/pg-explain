import type { Severity } from "./api.ts";

export const SEV_COLOR: Record<Severity, string> = {
  error: "var(--sev-error)",
  warn: "var(--sev-warn)",
  info: "var(--sev-info)",
};

export const SEV_LABEL: Record<Severity, string> = { error: "Critical", warn: "Warning", info: "Note" };

/** Lock-domain findings get a lock badge and sort first in the findings tab. */
export const isLock = (code: string) =>
  /^PGX_(LOCK|DDL|WRITE|DROP_INDEX|SELECT_FOR|UPDATE_UNINDEXED)/.test(code);
