import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Severity, Thresholds } from "./core/model.ts";
import { opError } from "./diagnostics/catalog.ts";

export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
}

export interface PgExplainConfig {
  thresholds: Thresholds;
  /** Per-rule enable/disable and severity overrides, keyed by rule id. */
  rules: Record<string, RuleConfig>;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  seqScanRows: 100_000,
  nestedLoopOuterRows: 10_000,
  filterDiscardRatio: 0.9,
  filterRemovedAbs: 10_000,
  misestimateFactor: 10,
  heapFetchRatio: 0.1,
  heapFetchAbs: 1_000,
  correlatedLoops: 1_000,
  jitPct: 25,
  triggerPct: 10,
  lowCacheHitRatio: 0.9,
};

export const DEFAULT_CONFIG: PgExplainConfig = {
  thresholds: { ...DEFAULT_THRESHOLDS },
  rules: {},
};

const CONFIG_FILES = [".pgexplainrc.json", ".pgexplainrc"];

/** A partial config as it appears in a config file (all fields optional). */
interface PartialConfig {
  thresholds?: Partial<Thresholds>;
  rules?: Record<string, RuleConfig>;
}

function merge(partial: PartialConfig): PgExplainConfig {
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...(partial.thresholds ?? {}) },
    rules: { ...(partial.rules ?? {}) },
  };
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw opError(
      "PGX_EMPTY_INPUT",
      {
        detail: `Could not read config '${path}': ${err instanceof Error ? err.message : String(err)}`,
      },
      err,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw opError(
      "PGX_MALFORMED_JSON",
      {
        detail: `Config '${path}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
      err,
    );
  }
}

/**
 * Load config: an explicit --config path, else a `.pgexplainrc[.json]` or a
 * `pgExplain` key in package.json in cwd. Missing config is fine (returns defaults);
 * an unreadable/invalid explicit path is an actionable error.
 */
export async function loadConfig(
  explicitPath: string | undefined,
  cwd = process.cwd(),
): Promise<PgExplainConfig> {
  if (explicitPath) return merge((await readJson(explicitPath)) as PartialConfig);

  for (const name of CONFIG_FILES) {
    try {
      const text = await readFile(join(cwd, name), "utf8");
      return merge(JSON.parse(text) as PartialConfig);
    } catch {
      // not present / unreadable — try the next source
    }
  }

  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      pgExplain?: PartialConfig;
    };
    if (pkg.pgExplain) return merge(pkg.pgExplain);
  } catch {
    // no package.json or no key — fall through to defaults
  }

  return { ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_THRESHOLDS }, rules: {} };
}
