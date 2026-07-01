import type { Rule } from "../../core/model.ts";
import { fmtInt } from "../../util/format.ts";
import { DOCS, makeFinding } from "./util.ts";

/**
 * A Memoize node whose cache is thrashing: entries are evicted faster than they
 * are reused, or single entries overflow the cache entirely. The planner chose
 * Memoize expecting repeated key lookups to hit the cache; when work_mem is too
 * small for the key space, the node pays cache maintenance overhead for nothing.
 * ponytail: self-normalizing condition (evictions > hits, or any overflow) — no
 * config threshold; a thrashing cache is bad at any absolute size.
 */
export const memoizeEvictions: Rule = {
  id: "PGX_MEMOIZE_EVICTIONS",
  title: "Memoize cache is thrashing",
  defaultSeverity: "warn",
  requiresAnalyze: true,
  check(node, ctx) {
    if (node.nodeType !== "Memoize") return [];

    const hits = node.cacheHits ?? 0;
    const evictions = node.cacheEvictions ?? 0;
    const overflows = node.cacheOverflows ?? 0;
    const thrashing = evictions > hits;
    if (!thrashing && overflows === 0) return [];

    return [
      makeFinding(memoizeEvictions, ctx, node, {
        title:
          overflows > 0
            ? `Memoize cache overflowed ${fmtInt(overflows)} time(s)`
            : `Memoize evicted ${fmtInt(evictions)} entries against ${fmtInt(hits)} hits`,
        detail: `The Memoize cache recorded ${fmtInt(hits)} hits, ${fmtInt(node.cacheMisses ?? 0)} misses, ${fmtInt(evictions)} evictions, and ${fmtInt(overflows)} overflows — entries are being thrown away before they can be reused.`,
        cause:
          "The distinct key values do not fit in the memory Memoize is allowed (derived from work_mem × hash_mem_multiplier), so the cache churns and the node degenerates into a slower re-executing inner side.",
        remediation: {
          summary:
            "Give the session more cache memory (work_mem / hash_mem_multiplier) so the key space fits, or reduce the number of distinct keys flowing into the Memoize.",
          steps: [
            "Estimate the distinct keys: the planner sizes the cache from ndistinct of the join key.",
            "Raise work_mem (or hash_mem_multiplier on PG 15+) for this workload and re-run.",
            "If the key space is genuinely huge, an index on the inner side may beat Memoize — compare with enable_memoize = off.",
          ],
          commands: [
            { label: "More cache memory for this session", sql: "SET work_mem = '64MB';" },
            {
              label: "Compare the plan without Memoize",
              sql: "SET enable_memoize = off; EXPLAIN ANALYZE <query>;",
            },
          ],
        },
        docsUrl: `${DOCS}/runtime-config-resource.html`,
        meta: { hits, evictions, overflows },
      }),
    ];
  },
};
