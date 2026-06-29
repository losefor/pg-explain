import { describe, expect, it } from "vitest";
import { browserCommand, openInBrowser } from "../../../src/util/open.ts";

describe("browserCommand", () => {
  it("picks the right opener per platform", () => {
    expect(browserCommand("darwin")).toBe("open");
    expect(browserCommand("win32")).toBe("start");
    expect(browserCommand("linux")).toBe("xdg-open");
  });
});

describe("openInBrowser", () => {
  it("is best-effort and never throws", () => {
    // Force the linux opener so no browser actually launches on the test machine;
    // a missing xdg-open surfaces as an async 'error' event, which is swallowed.
    expect(() => openInBrowser("/no/such/report.html", "linux")).not.toThrow();
  });
});
