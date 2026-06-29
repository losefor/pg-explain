import type { Rule } from "../../core/model.ts";
import { fmtInt, fmtKiB, roundUpMiB } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A Hash node split its build side into multiple batches, meaning the hash table did
 * not fit in work_mem and spilled to disk. The ideal is a single batch; more batches
 * than originally planned (hashBatches > originalHashBatches) means Postgres also had
 * to re-partition at runtime after under-sizing the build side.
 */
export const hashSpillDisk: Rule = {
  id: "PGX_HASH_SPILL_DISK",
  title: "Hash join spilled to disk",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Hash") return [];

    const hashBatches = node.hashBatches ?? 1;
    if (hashBatches <= 1) return [];

    const originalHashBatches = node.originalHashBatches ?? hashBatches;
    const repartitioned = hashBatches > originalHashBatches;

    // Size work_mem to hold the whole build side (peak memory + what spilled) with headroom.
    const peakKiB = node.peakMemoryUsage ?? 0;
    const diskKiB = node.diskUsage ?? 0;
    const workMemRecommended = roundUpMiB((peakKiB + diskKiB) * 1.2);

    return [
      makeFinding(hashSpillDisk, ctx, node, {
        title: `Hash build side spilled to disk (${fmtInt(hashBatches)} batches)`,
        detail: `The hash table was split into ${fmtInt(hashBatches)} batches${
          repartitioned ? ` (up from ${fmtInt(originalHashBatches)} planned)` : ""
        }, so the build side did not fit in work_mem and overflowed to temporary files${
          diskKiB > 0 ? ` (${fmtKiB(diskKiB)} written to disk)` : ""
        }.`,
        cause: repartitioned
          ? "Postgres had to add batches at runtime because the build side was larger than estimated — usually a row underestimate sized work_mem too small."
          : "The build (hash) side was larger than work_mem, forcing the hash join to partition it across disk-backed batches.",
        remediation: {
          summary: `Raise work_mem to about ${workMemRecommended} so the build side fits in a single batch, and make sure the SMALLER input is the hash/build side (a wrong build side usually comes from a row underestimate — fix the stats). Reducing build-side rows also avoids the spill.`,
          steps: [
            `Set work_mem high enough to hold the build side in one batch (~${workMemRecommended} here) at session or role scope, not globally — every sort/hash node can use work_mem, so a global bump can exhaust memory.`,
            "Confirm the smaller relation is on the build (Hash) side; if Postgres chose the larger side, a row underestimate is likely — re-run ANALYZE or raise statistics targets so the planner picks the smaller build side.",
            "Alternatively, filter or aggregate the build side earlier so fewer rows need to be hashed.",
          ],
          commands: [
            {
              label: "Raise work_mem for this session",
              sql: `SET work_mem = '${workMemRecommended}';`,
            },
            {
              label: "Or set it for a specific role",
              sql: `ALTER ROLE <role> SET work_mem = '${workMemRecommended}';`,
            },
            {
              label: "Refresh planner statistics on the build-side table",
              sql: "ANALYZE <build_side_table>;",
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html#GUC-WORK-MEM`,
        meta: { hashBatches, workMemRecommended },
      }),
    ];
  },
};
