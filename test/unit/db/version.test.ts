import { describe, expect, it } from "vitest";
import { capabilities, versionLabel } from "../../../src/db/version.ts";

describe("capabilities", () => {
  it("gates options by major version", () => {
    const pg11 = capabilities(110010);
    expect(pg11.settings).toBe(false); // 12+
    expect(pg11.summary).toBe(true); // 10+

    const pg16 = capabilities(160006);
    expect(pg16.settings).toBe(true);
    expect(pg16.wal).toBe(true); // 13+
    expect(pg16.genericPlan).toBe(true); // 16+
    expect(pg16.serialize).toBe(false); // 17+

    expect(capabilities(170002).serialize).toBe(true);
  });

  it("formats a version label", () => {
    expect(versionLabel(160006)).toBe("16.6");
  });
});
