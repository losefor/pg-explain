import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../lib/api.ts";
import { FindingCard } from "./Results.tsx";

const finding: Diagnostic = {
  code: "PGX_SEQ_SCAN_LARGE",
  domain: "plan",
  severity: "warn",
  title: "Sequential scan on orders",
  detail: "Postgres read orders sequentially.",
  cause: "No index narrowed the scan.",
  remediation: {
    summary: "Add an index covering the predicate.",
    commands: [{ label: "Index it", sql: "CREATE INDEX ON orders (status);" }],
  },
  docsUrl: "https://www.postgresql.org/docs/current/indexes-intro.html",
};

describe("FindingCard", () => {
  it("renders the what/why/fix triad with severity badge and SQL command", () => {
    render(<FindingCard d={finding} />);
    expect(screen.getByText("Warning")).toBeDefined();
    expect(screen.getByText("Sequential scan on orders")).toBeDefined();
    expect(screen.getByText("PGX_SEQ_SCAN_LARGE")).toBeDefined();
    expect(screen.getByText(/read orders sequentially/)).toBeDefined();
    expect(screen.getByText(/No index narrowed/)).toBeDefined();
    expect(screen.getByText("CREATE INDEX ON orders (status);")).toBeDefined();
    expect(screen.getByRole("link", { name: /PostgreSQL docs/ })).toBeDefined();
  });

  it("shows the lock badge for lock findings", () => {
    render(<FindingCard d={finding} lock />);
    expect(screen.getByText("lock")).toBeDefined();
  });
});
