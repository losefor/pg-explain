import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type DiffArgs, runDiff } from "../../../src/commands/diff.ts";
import { DEFAULT_CONFIG } from "../../../src/config.ts";
import { AppError } from "../../../src/diagnostics/diagnostic.ts";
import { ExitCode } from "../../../src/util/exit.ts";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));

let outDir: string;
beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "pgx-diff-"));
});

function args(overrides: Partial<DiffArgs>): DiffArgs {
  return {
    before: join(FIXTURES, "small-seq-scan.json"),
    after: join(FIXTURES, "seq-scan-large.json"),
    format: "json",
    color: "never",
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

describe("diff command", () => {
  it("compares two plans and writes the diff (exit 0)", async () => {
    const output = join(outDir, "diff.json");
    const code = await runDiff(args({ output }));
    expect(code).toBe(ExitCode.Success);
    const diff = JSON.parse(await readFile(output, "utf8"));
    expect(diff.newFindings.length).toBeGreaterThan(0);
  });

  it("--fail-on-new-findings trips when the after plan adds findings (exit 1)", async () => {
    const code = await runDiff(
      args({ output: join(outDir, "gate.json"), failOnNewFindings: true }),
    );
    expect(code).toBe(ExitCode.CiGate);
  });

  it("--fail-on-new-findings passes when nothing new appears (exit 0)", async () => {
    const code = await runDiff(
      args({
        after: join(FIXTURES, "small-seq-scan.json"),
        output: join(outDir, "same.json"),
        failOnNewFindings: true,
      }),
    );
    expect(code).toBe(ExitCode.Success);
  });

  it("--fail-on-slower trips when execution time regressed past the threshold", async () => {
    const output = join(outDir, "slower.json");
    const code = await runDiff(args({ output, failOnSlowerPct: 10 }));
    const diff = JSON.parse(await readFile(output, "utf8"));
    // Sanity: the fixture pair actually regresses, so the gate result is meaningful.
    expect(diff.execDeltaPct).toBeGreaterThan(10);
    expect(code).toBe(ExitCode.CiGate);
  });

  it("unreadable plan file throws PGX_EMPTY_INPUT", async () => {
    const err = await runDiff(args({ before: join(FIXTURES, "missing.json") })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).diagnostic.code).toBe("PGX_EMPTY_INPUT");
  });
});
