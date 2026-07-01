import { describe, expect, it } from "vitest";
import { renderLocks } from "../../../src/commands/locks.ts";
import type { LiveLocks } from "../../../src/locks/live.ts";
import { configureColor } from "../../../src/util/color.ts";

configureColor("never");

const session = (pid: number, blockedBy: number[]): LiveLocks["sessions"][number] => ({
  pid,
  user: "app",
  state: "active",
  waitEventType: blockedBy.length ? "Lock" : null,
  waitEvent: blockedBy.length ? "transactionid" : null,
  ageSeconds: blockedBy.length ? 12.4 : null,
  query: `UPDATE t SET a = ${pid}`,
  blockedBy,
});

describe("locks command rendering", () => {
  it("reports a calm system", () => {
    const out = renderLocks({ sessions: [session(1, [])], blocked: [], capturedAt: 0 });
    expect(out).toContain("No lock contention");
    expect(out).toContain("1 client session(s) · 0 blocked");
  });

  it("shows blocker pids, wait age, and a cancel remediation", () => {
    const blocked = session(20, [10]);
    const out = renderLocks({
      sessions: [session(10, []), blocked],
      blocked: [blocked],
      capturedAt: 0,
    });
    expect(out).toContain("pid 20 (app) blocked by pid 10");
    expect(out).toContain("waiting 12s");
    expect(out).toContain("Lock/transactionid");
    expect(out).toContain("pg_cancel_backend(10)");
  });
});
