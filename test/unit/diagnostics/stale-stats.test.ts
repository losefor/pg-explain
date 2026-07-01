import { describe, expect, it, vi } from "vitest";
import { runAdvisor } from "../../../src/advisor/index.ts";
import { DEFAULT_CONFIG, type PgExplainConfig } from "../../../src/config.ts";
import {
  appendFindings,
  checkStaleStats,
  staleStatsFindings,
} from "../../../src/diagnostics/stale-stats.ts";
import type { RelationStat } from "../../../src/server/schema.ts";
import { relationStats } from "../../../src/server/schema.ts";
import { loadTree } from "../helpers.ts";

vi.mock("../../../src/server/schema.ts", () => ({
  relationStats: vi.fn(),
}));

const stat = (over: Partial<RelationStat>): RelationStat => ({
  relation: "orders",
  estRows: 500_000,
  totalBytes: null,
  tableBytes: null,
  indexes: [],
  lastVacuum: null,
  lastAutovacuum: null,
  lastAnalyze: "2026-06-01T00:00:00Z",
  lastAutoanalyze: null,
  modSinceAnalyze: 0,
  liveTup: 500_000,
  ...over,
});

describe("PGX_STALE_STATISTICS", () => {
  it("flags a never-analyzed table", () => {
    const findings = staleStatsFindings(
      [stat({ lastAnalyze: null, lastAutoanalyze: null })],
      DEFAULT_CONFIG,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("PGX_STALE_STATISTICS");
    expect(findings[0]?.title).toMatch(/never been analyzed/);
    expect(findings[0]?.remediation.commands?.[0]?.sql).toBe("ANALYZE orders;");
  });

  it("flags a table whose modified-row ratio exceeds the threshold", () => {
    const findings = staleStatsFindings([stat({ modSinceAnalyze: 150_000 })], DEFAULT_CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toMatch(/stale/);
  });

  it("stays quiet for fresh stats, tiny tables, and disabled rule", () => {
    expect(staleStatsFindings([stat({ modSinceAnalyze: 10 })], DEFAULT_CONFIG)).toHaveLength(0);
    expect(
      staleStatsFindings([stat({ liveTup: 500, estRows: 500, lastAnalyze: null })], DEFAULT_CONFIG),
    ).toHaveLength(0);
    const disabled: PgExplainConfig = {
      ...DEFAULT_CONFIG,
      rules: { PGX_STALE_STATISTICS: { enabled: false } },
    };
    expect(staleStatsFindings([stat({ lastAnalyze: null })], disabled)).toHaveLength(0);
  });

  it("respects a config severity override", () => {
    const cfg: PgExplainConfig = {
      ...DEFAULT_CONFIG,
      rules: { PGX_STALE_STATISTICS: { severity: "info" } },
    };
    expect(staleStatsFindings([stat({ lastAnalyze: null })], cfg)[0]?.severity).toBe("info");
  });
});

const CONN = { connectTimeoutMs: 1000 };

describe("checkStaleStats", () => {
  it("fetches stats for the plan's relations and appends findings", async () => {
    vi.mocked(relationStats).mockResolvedValueOnce([
      stat({ lastAnalyze: null, lastAutoanalyze: null }),
    ]);
    const result = runAdvisor(loadTree("seq-scan-large.json"));
    await checkStaleStats(CONN, result, DEFAULT_CONFIG);
    expect(vi.mocked(relationStats)).toHaveBeenCalledWith(CONN, ["orders"]);
    expect(result.diagnostics.some((d) => d.code === "PGX_STALE_STATISTICS")).toBe(true);
  });

  it("never fails the run when the stats query errors", async () => {
    vi.mocked(relationStats).mockRejectedValueOnce(new Error("connection lost"));
    const result = runAdvisor(loadTree("seq-scan-large.json"));
    await expect(checkStaleStats(CONN, result, DEFAULT_CONFIG)).resolves.toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === "PGX_STALE_STATISTICS")).toBe(false);
  });
});

describe("appendFindings", () => {
  it("re-sorts and upgrades worstSeverity", () => {
    const result = runAdvisor(loadTree("small-seq-scan.json"));
    expect(result.worstSeverity).toBeNull();
    const extra = staleStatsFindings([stat({ lastAnalyze: null })], DEFAULT_CONFIG);
    appendFindings(result, extra);
    expect(result.worstSeverity).toBe("warn");
    expect(result.diagnostics.some((d) => d.code === "PGX_STALE_STATISTICS")).toBe(true);
  });
});
