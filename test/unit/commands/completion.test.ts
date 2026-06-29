import { describe, expect, it, vi } from "vitest";
import { runCompletion } from "../../../src/commands/completion.ts";
import { ExitCode } from "../../../src/util/exit.ts";

describe("runCompletion", () => {
  it("prints a bash script", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = runCompletion("bash");
    expect(code).toBe(ExitCode.Success);
    expect(spy.mock.calls[0]?.[0]).toContain("complete -F _pg_explain pg-explain");
    spy.mockRestore();
  });

  it("supports zsh and fish", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(runCompletion("zsh")).toBe(ExitCode.Success);
    expect(runCompletion("fish")).toBe(ExitCode.Success);
    spy.mockRestore();
  });

  it("errors with usage for an unknown shell", () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(runCompletion("powershell")).toBe(ExitCode.Usage);
    expect(runCompletion(undefined)).toBe(ExitCode.Usage);
    spy.mockRestore();
  });
});
