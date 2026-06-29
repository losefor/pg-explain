import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, loadConfig } from "../../src/config.ts";
import { AppError } from "../../src/diagnostics/diagnostic.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pgx-cfg-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config exists", async () => {
    const empty = await mkdtemp(join(tmpdir(), "pgx-empty-"));
    const config = await loadConfig(undefined, empty);
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.rules).toEqual({});
    await rm(empty, { recursive: true, force: true });
  });

  it("merges thresholds and rule overrides from an explicit file", async () => {
    const path = join(dir, "custom.json");
    await writeFile(
      path,
      JSON.stringify({
        thresholds: { seqScanRows: 5 },
        rules: { PGX_SEQ_SCAN_LARGE: { enabled: false } },
      }),
    );
    const config = await loadConfig(path);
    expect(config.thresholds.seqScanRows).toBe(5);
    expect(config.thresholds.misestimateFactor).toBe(DEFAULT_THRESHOLDS.misestimateFactor); // merged
    expect(config.rules.PGX_SEQ_SCAN_LARGE?.enabled).toBe(false);
  });

  it("discovers .pgexplainrc.json in the cwd", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pgx-disc-"));
    await writeFile(join(cwd, ".pgexplainrc.json"), JSON.stringify({ thresholds: { jitPct: 99 } }));
    const config = await loadConfig(undefined, cwd);
    expect(config.thresholds.jitPct).toBe(99);
    await rm(cwd, { recursive: true, force: true });
  });

  it("throws an actionable error for malformed config", async () => {
    const path = join(dir, "bad.json");
    await writeFile(path, "{ not json");
    await expect(loadConfig(path)).rejects.toBeInstanceOf(AppError);
  });
});
