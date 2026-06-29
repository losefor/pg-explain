import { z } from "zod";

/**
 * Version-tolerant validation for EXPLAIN (FORMAT JSON) output.
 *
 * We only assert the *shape* we depend on ("Node Type" + recursive "Plans"); every
 * other field is accepted and preserved via looseObject so plans from PG 14 → 18
 * validate identically. Field access happens against the original parsed JSON (the
 * `raw` node), so unknown/new fields are never lost.
 */
const PlanNodeSchema = z.looseObject({
  "Node Type": z.string(),
  get Plans() {
    return z.array(PlanNodeSchema).optional();
  },
});

const StatementSchema = z.looseObject({
  Plan: PlanNodeSchema,
  "Planning Time": z.number().optional(),
  "Execution Time": z.number().optional(),
  Triggers: z.array(z.looseObject({})).optional(),
  JIT: z.looseObject({}).optional(),
  Settings: z.record(z.string(), z.unknown()).optional(),
});

/** EXPLAIN FORMAT JSON is an array of statements (usually one). */
export const ExplainOutputSchema = z.array(StatementSchema).min(1);

export type ExplainOutput = z.infer<typeof ExplainOutputSchema>;
export type ExplainStatement = z.infer<typeof StatementSchema>;
