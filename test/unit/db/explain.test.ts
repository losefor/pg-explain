import { describe, expect, it } from "vitest";
import {
  buildExplain,
  DEFAULT_EXPLAIN_FLAGS,
  isReadOnlyStatement,
  parseDurationMs,
  splitStatements,
} from "../../../src/db/explain.ts";
import { capabilities } from "../../../src/db/version.ts";
import { AppError } from "../../../src/diagnostics/diagnostic.ts";

const PG16 = capabilities(160006);
const PG13 = capabilities(130010);

describe("buildExplain", () => {
  it("builds a sensible default prefix", () => {
    const { prefix } = buildExplain(DEFAULT_EXPLAIN_FLAGS, PG16);
    expect(prefix).toBe("EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)");
  });

  it("rejects an option the server is too old for", () => {
    expect(() =>
      buildExplain({ ...DEFAULT_EXPLAIN_FLAGS, genericPlan: true, analyze: false }, PG13),
    ).toThrow(AppError);
  });

  it("auto-omits unsupported options under --compat", () => {
    const { prefix, omitted } = buildExplain(
      { ...DEFAULT_EXPLAIN_FLAGS, settings: true, compat: true },
      capabilities(110010), // PG 11 — no SETTINGS
    );
    expect(omitted).toContain("SETTINGS");
    expect(prefix).not.toContain("SETTINGS");
  });

  it("rejects GENERIC_PLAN + ANALYZE and WAL without ANALYZE", () => {
    expect(() => buildExplain({ ...DEFAULT_EXPLAIN_FLAGS, genericPlan: true }, PG16)).toThrow(
      AppError,
    );
    expect(() =>
      buildExplain({ ...DEFAULT_EXPLAIN_FLAGS, wal: true, analyze: false }, PG16),
    ).toThrow(AppError);
  });
});

describe("isReadOnlyStatement", () => {
  it("treats SELECT/WITH(SELECT)/VALUES as read-only", () => {
    expect(isReadOnlyStatement("SELECT 1")).toBe(true);
    expect(isReadOnlyStatement("  -- c\n WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(isReadOnlyStatement("VALUES (1),(2)")).toBe(true);
  });
  it("treats DML/DDL and data-modifying CTEs as not read-only", () => {
    expect(isReadOnlyStatement("UPDATE t SET a=1")).toBe(false);
    expect(isReadOnlyStatement("INSERT INTO t VALUES (1)")).toBe(false);
    expect(isReadOnlyStatement("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d")).toBe(
      false,
    );
  });
});

describe("splitStatements", () => {
  it("splits on top-level semicolons only", () => {
    expect(splitStatements("select 1; select 2;")).toEqual(["select 1", "select 2"]);
  });
  it("ignores semicolons inside strings, comments, and dollar-quotes", () => {
    expect(splitStatements("select ';' as a; select 2")).toEqual(["select ';' as a", "select 2"]);
    expect(splitStatements("select 1 -- ; not a split\n; select 2")).toHaveLength(2);
    expect(splitStatements("do $$ begin perform 1; end $$; select 2")).toHaveLength(2);
  });
});

describe("parseDurationMs", () => {
  it("parses common duration forms", () => {
    expect(parseDurationMs("60s")).toBe(60_000);
    expect(parseDurationMs("500ms")).toBe(500);
    expect(parseDurationMs("2min")).toBe(120_000);
    expect(parseDurationMs("5000")).toBe(5000);
  });
  it("throws on garbage", () => {
    expect(() => parseDurationMs("soon")).toThrow(AppError);
  });
});
