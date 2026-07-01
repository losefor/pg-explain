import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type AnalyzeArgs, runAnalyze } from "../../../src/commands/analyze.ts";
import { DEFAULT_CONFIG } from "../../../src/config.ts";
import { AppError } from "../../../src/diagnostics/diagnostic.ts";
import { ExitCode } from "../../../src/util/exit.ts";

const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));

let outDir: string;
beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "pgx-analyze-"));
});

function args(overrides: Partial<AnalyzeArgs>): AnalyzeArgs {
  return { format: "json", color: "never", config: DEFAULT_CONFIG, ...overrides };
}

describe("analyze command", () => {
  it("analyzes a plan file and writes a report (exit 0)", async () => {
    const output = join(outDir, "report.json");
    const code = await runAnalyze(args({ file: join(FIXTURES, "seq-scan-large.json"), output }));
    expect(code).toBe(ExitCode.Success);
    const report = JSON.parse(await readFile(output, "utf8"));
    expect(report.schemaVersion).toBe(1);
    expect(report.diagnostics.some((d: { code: string }) => d.code === "PGX_SEQ_SCAN_LARGE")).toBe(
      true,
    );
  });

  it("--fail-on trips the CI gate when severity is reached (exit 1)", async () => {
    const code = await runAnalyze(
      args({
        file: join(FIXTURES, "seq-scan-large.json"),
        output: join(outDir, "gate.json"),
        failOn: "warn",
      }),
    );
    expect(code).toBe(ExitCode.CiGate);
  });

  it("--fail-on does not trip below the threshold (exit 0)", async () => {
    const code = await runAnalyze(
      args({
        file: join(FIXTURES, "small-seq-scan.json"),
        output: join(outDir, "clean.json"),
        failOn: "warn",
      }),
    );
    expect(code).toBe(ExitCode.Success);
  });

  it("unreadable file throws an AppError with the Input exit code", async () => {
    const err = await runAnalyze(args({ file: join(FIXTURES, "does-not-exist.json") })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).exitCode).toBe(ExitCode.Input);
  });

  it("malformed JSON throws an AppError with the Parse exit code", async () => {
    const bad = join(outDir, "bad.txt");
    await writeFile(bad, "not json at all");
    const err = await runAnalyze(args({ file: bad })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).exitCode).toBe(ExitCode.Parse);
  });

  describe("batch (directory input)", () => {
    it("analyzes every .json plan and returns the worst exit code", async () => {
      const dir = await mkdtemp(join(tmpdir(), "pgx-batch-"));
      await writeFile(
        join(dir, "a.json"),
        await readFile(join(FIXTURES, "small-seq-scan.json"), "utf8"),
      );
      await writeFile(
        join(dir, "b.json"),
        await readFile(join(FIXTURES, "seq-scan-large.json"), "utf8"),
      );
      const output = join(outDir, "batch.json");
      const code = await runAnalyze(args({ file: dir, output, failOn: "warn" }));
      expect(code).toBe(ExitCode.CiGate);
      const reports = JSON.parse(await readFile(output, "utf8"));
      expect(reports).toHaveLength(2);
      expect(reports.map((r: { file: string }) => r.file)).toEqual(["a.json", "b.json"]);
    });

    it("skips unparseable files without aborting the batch (exit 4)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "pgx-batch-bad-"));
      await writeFile(join(dir, "broken.json"), "{nope");
      await writeFile(
        join(dir, "ok.json"),
        await readFile(join(FIXTURES, "small-seq-scan.json"), "utf8"),
      );
      const output = join(outDir, "batch-bad.json");
      const code = await runAnalyze(args({ file: dir, output }));
      expect(code).toBe(ExitCode.Parse);
      expect(JSON.parse(await readFile(output, "utf8"))).toHaveLength(1);
    });

    it("empty directory throws PGX_EMPTY_INPUT", async () => {
      const dir = await mkdtemp(join(tmpdir(), "pgx-batch-empty-"));
      const err = await runAnalyze(args({ file: dir })).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).diagnostic.code).toBe("PGX_EMPTY_INPUT");
    });
  });
});
