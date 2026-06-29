import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A Gather / Gather Merge node asked for more parallel workers than it got. Postgres
 * caps the total number of background workers globally (max_worker_processes /
 * max_parallel_workers), so a busy server can starve a query of the workers it planned
 * for, leaving the parallel plan running mostly serial. This is informational: if the
 * plan was not actually faster in parallel, fewer workers may be fine.
 */
export const workersNotLaunched: Rule = {
  id: "PGX_WORKERS_NOT_LAUNCHED",
  title: "Parallel workers planned but not launched",
  defaultSeverity: "info",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Gather" && node.nodeType !== "Gather Merge") return [];
    if (node.workersPlanned === undefined || node.workersLaunched === undefined) return [];
    if (node.workersLaunched >= node.workersPlanned) return [];

    const planned = node.workersPlanned;
    const launched = node.workersLaunched;
    const shortfall = planned - launched;

    return [
      makeFinding(workersNotLaunched, ctx, node, {
        title: `${node.nodeType} got ${fmtInt(launched)} of ${fmtInt(planned)} planned workers`,
        detail: `This ${node.nodeType} planned for ${fmtInt(planned)} parallel worker${
          planned === 1 ? "" : "s"
        } but only ${fmtInt(launched)} were launched (${fmtInt(shortfall)} short), so part of the work ran serially.`,
        cause:
          "The global background-worker pool was exhausted: max_worker_processes or max_parallel_workers was already saturated (often by other concurrent parallel queries) when this node tried to start its workers.",
        remediation: {
          summary: `Raise max_parallel_workers and max_worker_processes so the pool can supply the ${fmtInt(
            planned,
          )} workers this query plans for, and confirm max_parallel_workers_per_gather permits them. If parallelism is not actually speeding this query up, the shortfall is harmless.`,
          steps: [
            "Check current limits: max_worker_processes, max_parallel_workers, max_parallel_workers_per_gather.",
            "max_parallel_workers must be <= max_worker_processes; raise both together (max_worker_processes change needs a restart).",
            "Look for other concurrent parallel queries saturating the shared pool during peak load.",
            "If a serial plan is no slower here, leave the settings alone — this is informational.",
          ],
          commands: [
            {
              label: "Enlarge the global parallel-worker pool",
              sql: "ALTER SYSTEM SET max_parallel_workers = '<N>';\nALTER SYSTEM SET max_worker_processes = '<N+>';\nSELECT pg_reload_conf();",
            },
            {
              label: "Allow more workers per Gather",
              sql: "ALTER SYSTEM SET max_parallel_workers_per_gather = '<N>';\nSELECT pg_reload_conf();",
            },
            {
              label: "Inspect the current settings",
              sql: "SELECT name, setting FROM pg_settings WHERE name IN ('max_worker_processes', 'max_parallel_workers', 'max_parallel_workers_per_gather');",
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html#GUC-MAX-PARALLEL-WORKERS`,
        meta: { planned, launched },
      }),
    ];
  },
};
