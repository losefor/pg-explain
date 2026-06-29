import type { Rule } from "../../core/model.ts";
import { fmtKiB, roundUpMiB } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A Sort node spilled to disk because it exceeded work_mem. External merge sorts do
 * extra temp-file I/O and are far slower than an in-memory quicksort. Either raise
 * work_mem for this query, or feed the sort pre-ordered rows via a matching index.
 */
export const sortSpillDisk: Rule = {
  id: "PGX_SORT_SPILL_DISK",
  title: "Sort spilled to disk",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Sort") return [];

    const onDisk =
      node.sortSpaceType === "Disk" ||
      (node.sortMethod !== undefined && /external/i.test(node.sortMethod));
    if (!onDisk) return [];

    // Recommend ~2.2× the disk footprint (sort overhead vs. raw data) rounded up to MiB.
    const usedKiB = node.sortSpaceUsed ?? 0;
    const workMemRecommended = roundUpMiB(usedKiB > 0 ? usedKiB * 2.2 : 0);
    const usedText = usedKiB > 0 ? ` using ${fmtKiB(usedKiB)} of temp space` : "";
    const method = node.sortMethod ? ` (${node.sortMethod})` : "";
    const orderBy =
      node.sortKey && node.sortKey.length > 0 ? node.sortKey.join(", ") : "<ORDER BY columns>";

    const summary =
      usedKiB > 0
        ? `Raise work_mem for this query so the sort stays in memory, e.g. SET work_mem = '${workMemRecommended}' at session or role scope (do NOT raise it globally without accounting for max_connections — each connection can allocate work_mem several times over). Alternatively, add an index on (${orderBy}) so rows arrive pre-sorted and the Sort node disappears.`
        : `Raise work_mem for this query so the sort stays in memory, e.g. SET work_mem = '64MB' at session or role scope (do NOT raise it globally without accounting for max_connections — each connection can allocate work_mem several times over). Alternatively, add an index on (${orderBy}) so rows arrive pre-sorted and the Sort node disappears.`;

    return [
      makeFinding(sortSpillDisk, ctx, node, {
        title: `Sort spilled to disk${usedText}`,
        detail: `The Sort node ran an external merge sort on disk${method}${usedText}, because the data exceeded work_mem.`,
        cause:
          "work_mem was too small to hold the sort set, so Postgres wrote sorted runs to temporary files and merged them — adding temp-file I/O that an in-memory sort avoids.",
        remediation: {
          summary,
          steps: [
            "Set work_mem at session or role scope for this workload, not cluster-wide.",
            `Size it above the spilled footprint${usedKiB > 0 ? ` (~${fmtKiB(usedKiB)}); ${workMemRecommended} leaves headroom` : ""}.`,
            `Or add an index on (${orderBy}) so the sort is satisfied by an ordered scan and removed entirely.`,
          ],
          commands: [
            {
              label: "Raise work_mem for this session",
              sql: `SET work_mem = '${usedKiB > 0 ? workMemRecommended : "64MB"}';`,
            },
            {
              label: "Or set it per role",
              sql: `ALTER ROLE <role> SET work_mem = '${usedKiB > 0 ? workMemRecommended : "64MB"}';`,
            },
            {
              label: "Or add an index matching the sort key",
              sql: `CREATE INDEX ON <table> (${orderBy});`,
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html#GUC-WORK-MEM`,
        meta: { sortSpaceUsedKiB: Math.round(usedKiB), workMemRecommended },
      }),
    ];
  },
};
