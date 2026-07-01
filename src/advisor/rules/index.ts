import type { Rule } from "../../core/model.ts";
import { bitmapLossy } from "./bitmap-lossy.ts";
import { cartesianProduct } from "./cartesian-product.ts";
import { correlatedSubplan } from "./correlated-subplan.ts";
import { couldBeIndexOnly } from "./could-be-index-only.ts";
import { filterCouldBeIndexCond } from "./filter-could-be-index-cond.ts";
import { hashSpillDisk } from "./hash-spill-disk.ts";
import { highFilterDiscard } from "./high-filter-discard.ts";
import { indexOnlyHeapFetches } from "./index-only-heap-fetches.ts";
import { limitLargeOffset } from "./limit-large-offset.ts";
import { lowCacheHit } from "./low-cache-hit.ts";
import { memoizeEvictions } from "./memoize-evictions.ts";
import { nestedLoopLargeOuter } from "./nested-loop-large-outer.ts";
import { rowMisestimate } from "./row-misestimate.ts";
import { seqScanLarge } from "./seq-scan-large.ts";
import { significantJit } from "./significant-jit.ts";
import { sortSpillDisk } from "./sort-spill-disk.ts";
import { triggerTime } from "./trigger-time.ts";
import { workersNotLaunched } from "./workers-not-launched.ts";

/**
 * Every advisor rule, in display order (most actionable structural issues first).
 * Rule ids ARE the PGX_* diagnostic codes (greppable, config-keyed). One file per rule.
 */
export const ALL_RULES: Rule[] = [
  cartesianProduct,
  seqScanLarge,
  nestedLoopLargeOuter,
  highFilterDiscard,
  limitLargeOffset,
  sortSpillDisk,
  hashSpillDisk,
  memoizeEvictions,
  correlatedSubplan,
  rowMisestimate,
  filterCouldBeIndexCond,
  couldBeIndexOnly,
  indexOnlyHeapFetches,
  bitmapLossy,
  workersNotLaunched,
  lowCacheHit,
  significantJit,
  triggerTime,
];
