import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_THRESHOLDS, type PgExplainConfig } from "../config.ts";
import { dataDir } from "./store/sqlite.ts";

function configPath(): string {
  return join(dataDir(), "config.json");
}

/** A live, swappable config holder so settings changes apply to later analyses. */
export interface ConfigHolder {
  current: PgExplainConfig;
}

function merge(raw: Partial<PgExplainConfig>): PgExplainConfig {
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...(raw.thresholds ?? {}) },
    rules: raw.rules ?? {},
  };
}

/** Read the studio's saved config (data dir), falling back to defaults. */
export async function readStudioConfig(): Promise<PgExplainConfig> {
  try {
    return merge(JSON.parse(await readFile(configPath(), "utf8")));
  } catch {
    return merge({});
  }
}

/** Persist a config to the data dir and return the normalized result. */
export async function writeStudioConfig(raw: Partial<PgExplainConfig>): Promise<PgExplainConfig> {
  const cfg = merge(raw);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}
