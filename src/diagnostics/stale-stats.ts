import type { PgExplainConfig } from "../config.ts";
import type { AnalysisResult, Diagnostic, Severity } from "../core/model.ts";
import { flatten } from "../core/parse.ts";
import type { ConnectionOptions } from "../db/client.ts";
import { type RelationStat, relationStats } from "../server/schema.ts";
import { bySeverity, finding, maxSeverity } from "./diagnostic.ts";

const RULE_ID = "PGX_STALE_STATISTICS";
const DOCS = "https://www.postgresql.org/docs/current/routine-vacuuming.html#VACUUM-FOR-STATISTICS";

// ponytail: fixed noise floor — tiny tables misestimate harmlessly and ANALYZE is instant there.
const MIN_ROWS = 1_000;

/**
 * Planner-statistics staleness check. Not a plan-node rule: it needs
 * pg_stat_user_tables, so it only runs on the `run` path (CLI + studio) where a
 * connection exists. Emits ordinary findings keyed by PGX_STALE_STATISTICS so
 * config can disable it or override severity like any other rule.
 */
export function staleStatsFindings(stats: RelationStat[], config: PgExplainConfig): Diagnostic[] {
  if (config.rules[RULE_ID]?.enabled === false) return [];
  const severity: Severity = config.rules[RULE_ID]?.severity ?? "warn";
  const ratioLimit = config.thresholds.staleStatsModRatio;

  const out: Diagnostic[] = [];
  for (const s of stats) {
    const rows = s.liveTup ?? s.estRows ?? 0;
    if (rows < MIN_ROWS) continue;

    const neverAnalyzed = !s.lastAnalyze && !s.lastAutoanalyze;
    const modRatio = s.modSinceAnalyze != null && rows > 0 ? s.modSinceAnalyze / rows : 0;

    if (!neverAnalyzed && modRatio < ratioLimit) continue;

    out.push(
      finding(RULE_ID, severity, {
        title: neverAnalyzed
          ? `Table ${s.relation} has never been analyzed`
          : `Planner statistics on ${s.relation} are stale`,
        detail: neverAnalyzed
          ? `${s.relation} (~${Math.round(rows).toLocaleString()} rows) has no planner statistics — pg_stat_user_tables shows no manual or auto ANALYZE.`
          : `${s.modSinceAnalyze?.toLocaleString()} rows of ${s.relation} changed since its last ANALYZE (${(modRatio * 100).toFixed(0)}% of ~${Math.round(rows).toLocaleString()} live rows).`,
        cause:
          "The planner chooses plans from per-table statistics. When they are missing or stale, row estimates drift, which cascades into bad join orders, wrong scan types, and misestimates like PGX_ROW_MISESTIMATE.",
        remediation: {
          summary: `Run ANALYZE on ${s.relation}, and if it keeps going stale, lower its autovacuum analyze threshold.`,
          steps: [
            "ANALYZE the table now to refresh statistics.",
            "If the table churns heavily, tune per-table autovacuum settings so auto-analyze keeps up.",
          ],
          commands: [
            { label: "Refresh statistics", sql: `ANALYZE ${s.relation};` },
            {
              label: "Analyze more eagerly on churny tables",
              sql: `ALTER TABLE ${s.relation} SET (autovacuum_analyze_scale_factor = 0.02);`,
            },
          ],
        },
        docsUrl: DOCS,
        meta: {
          relation: s.relation,
          modSinceAnalyze: s.modSinceAnalyze ?? 0,
          liveTup: s.liveTup ?? 0,
        },
      }),
    );
  }
  return out;
}

/**
 * Fetch pg_stat_user_tables for the relations in the plan and append staleness
 * findings to the result. Best-effort: a failed stats query never fails the run.
 */
export async function checkStaleStats(
  connection: ConnectionOptions,
  result: AnalysisResult,
  config: PgExplainConfig,
): Promise<void> {
  try {
    const relations = [
      ...new Set(
        flatten(result.tree.root)
          .map((n) => n.relationName)
          .filter((r): r is string => !!r),
      ),
    ];
    if (!relations.length) return;
    appendFindings(result, staleStatsFindings(await relationStats(connection, relations), config));
  } catch {
    // stats enrichment is best-effort
  }
}

/** Append post-analysis findings to a result, keeping sort order and worstSeverity consistent. */
export function appendFindings(result: AnalysisResult, extra: Diagnostic[]): void {
  if (!extra.length) return;
  result.diagnostics = [...result.diagnostics, ...extra].sort(bySeverity);
  result.worstSeverity = result.diagnostics.reduce<Severity | null>(
    (worst, d) => (worst === null ? d.severity : maxSeverity(worst, d.severity)),
    null,
  );
}
