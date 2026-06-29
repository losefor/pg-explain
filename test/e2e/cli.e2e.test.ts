import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const seqScan = readFileSync(`${FIXTURES}seq-scan-large.json`, "utf8");

function run(args: string[], input?: string) {
  return execa("node", [CLI, ...args], { reject: false, input });
}

describe("pg-explain binary (e2e)", () => {
  it("--version prints a semver and exits 0", async () => {
    const { stdout, exitCode } = await run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it("analyzes a plan from stdin → exit 0, valid JSON on stdout", async () => {
    const { stdout, exitCode } = await run(["-f", "json"], seqScan);
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.schemaVersion).toBe(1);
    expect(report.diagnostics.some((d: { code: string }) => d.code === "PGX_SEQ_SCAN_LARGE")).toBe(
      true,
    );
  });

  it("keeps stdout pure JSON and logs nothing to stderr on success", async () => {
    const { stderr } = await run(["-f", "json"], seqScan);
    expect(stderr).toBe("");
  });

  it("--fail-on warn trips the CI gate (exit 1)", async () => {
    const { exitCode } = await run(["-f", "json", "--fail-on", "warn"], seqScan);
    expect(exitCode).toBe(1);
  });

  it("malformed JSON → exit 4 with an actionable error on stderr", async () => {
    const { exitCode, stderr } = await run([], "[{not json}]");
    expect(exitCode).toBe(4);
    expect(stderr).toContain("PGX_MALFORMED_JSON");
    expect(stderr).toMatch(/fix:/i);
  });

  it("empty stdin → exit 3", async () => {
    const { exitCode } = await run([], "");
    expect(exitCode).toBe(3);
  });

  it("diff two plans → exit 0", async () => {
    const { exitCode, stdout } = await run([
      "diff",
      `${FIXTURES}seq-scan-large.json`,
      `${FIXTURES}nested-loop.json`,
      "-f",
      "json",
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toHaveProperty("execDeltaMs");
  });

  it("completion bash → exit 0", async () => {
    const { exitCode, stdout } = await run(["completion", "bash"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -F _pg_explain");
  });

  it("the binary has a shebang and does not statically import pg", () => {
    const cli = readFileSync(CLI, "utf8");
    expect(cli.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(cli).not.toMatch(/^import .* from ['"]pg['"]/m);
  });
});
