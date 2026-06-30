import { z } from "zod";
import type { Diagnostic } from "../core/model.ts";
import { AppError } from "../diagnostics/diagnostic.ts";
import { ExitCode } from "../util/exit.ts";

/** Validate a request body; on failure throw an AppError that renders as a 400 Diagnostic. */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
  const diagnostic: Diagnostic = {
    code: "PGX_BAD_REQUEST",
    domain: "operational",
    severity: "error",
    title: "Invalid request",
    detail: issues,
    cause: "The request body did not match the expected shape.",
    remediation: { summary: "Correct the highlighted fields and resend the request." },
  };
  throw new AppError(diagnostic, ExitCode.Usage);
}

export const ConnectionInputSchema = z.object({
  dsn: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  sslmode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]).optional(),
  sslrootcert: z.string().optional(),
  connectTimeoutMs: z.number().int().positive().optional(),
});
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

export const AnalyzeBodySchema = z.object({
  plan: z.string().min(1, "a plan (EXPLAIN FORMAT JSON) is required"),
  sql: z.string().optional(),
  statement: z.number().int().min(1).optional(),
  redact: z.boolean().optional(),
});
export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;

export const ExplainFlagsSchema = z
  .object({
    analyze: z.boolean(),
    buffers: z.boolean(),
    verbose: z.boolean(),
    settings: z.boolean(),
    wal: z.boolean(),
    timing: z.boolean(),
    costs: z.boolean(),
    summary: z.boolean(),
    genericPlan: z.boolean(),
    compat: z.boolean(),
  })
  .partial();

export const RunBodySchema = z
  .object({
    connection: ConnectionInputSchema.optional(),
    connectionId: z.string().optional(),
    sql: z.string().min(1, "SQL is required"),
    statement: z.number().int().min(1).optional(),
    params: z.array(z.string()).optional(),
    flags: ExplainFlagsSchema.optional(),
    redact: z.boolean().optional(),
    statementTimeoutMs: z.number().int().positive().optional(),
    lockTimeoutMs: z.number().int().positive().optional(),
    force: z.boolean().optional(),
  })
  .refine((b) => b.connection || b.connectionId, {
    message: "provide a connection or a connectionId",
    path: ["connection"],
  });
export type RunBody = z.infer<typeof RunBodySchema>;

export const AnalyzeSqlBodySchema = z
  .object({
    connection: ConnectionInputSchema.optional(),
    connectionId: z.string().optional(),
    sql: z.string().min(1, "SQL is required"),
    redact: z.boolean().optional(),
  })
  .refine((b) => b.connection || b.connectionId, {
    message: "provide a connection or connectionId",
  });

export const LiveLocksBodySchema = z
  .object({
    connection: ConnectionInputSchema.optional(),
    connectionId: z.string().optional(),
  })
  .refine((b) => b.connection || b.connectionId, {
    message: "provide a connection or connectionId",
  });

export const SchemaBodySchema = z
  .object({
    connection: ConnectionInputSchema.optional(),
    connectionId: z.string().optional(),
    relations: z.array(z.string()).min(1),
  })
  .refine((b) => b.connection || b.connectionId, {
    message: "provide a connection or connectionId",
  });

export const ConnectionCreateSchema = z.object({
  name: z.string().min(1, "a name is required"),
  dsn: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  database: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  sslmode: z.enum(["disable", "prefer", "require", "verify-ca", "verify-full"]).optional(),
  sslrootcert: z.string().optional(),
});
export type ConnectionCreate = z.infer<typeof ConnectionCreateSchema>;

export const SettingsBodySchema = z.object({
  thresholds: z.record(z.string(), z.number()).optional(),
  rules: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        severity: z.enum(["error", "warn", "info"]).optional(),
      }),
    )
    .optional(),
});

export const ExportBodySchema = z
  .object({
    runId: z.string().optional(),
    plan: z.string().optional(),
    format: z.enum(["markdown", "html", "text", "json"]),
    sql: z.string().optional(),
    redact: z.boolean().optional(),
  })
  .refine((b) => b.runId || b.plan, { message: "provide runId or plan" });

export const RunPatchSchema = z.object({
  starred: z.boolean().optional(),
  label: z.string().nullable().optional(),
  baseline: z.boolean().optional(),
});

export const DiffBodySchema = z
  .object({
    beforePlan: z.string().optional(),
    afterPlan: z.string().optional(),
    beforeId: z.string().optional(),
    afterId: z.string().optional(),
    redact: z.boolean().optional(),
  })
  .refine((b) => (b.beforePlan && b.afterPlan) || (b.beforeId && b.afterId), {
    message: "provide beforePlan+afterPlan or beforeId+afterId",
  });
export type DiffBody = z.infer<typeof DiffBodySchema>;
