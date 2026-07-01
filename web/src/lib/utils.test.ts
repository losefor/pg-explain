import { describe, expect, it } from "vitest";
import type { PlanNode } from "./api.ts";
import { cn, collectRelations, fmtBytes, isScripty } from "./utils.ts";

const node = (relationName: string | null, children: PlanNode[] = []): PlanNode =>
  ({ relationName, children }) as unknown as PlanNode;

describe("isScripty", () => {
  it("plain reads are not scripty", () => {
    expect(isScripty("select 1")).toBe(false);
    expect(isScripty("  SELECT * FROM t;")).toBe(false);
    expect(isScripty("with x as (select 1) select * from x")).toBe(false);
    expect(isScripty("EXPLAIN select 1")).toBe(false);
    expect(isScripty("values (1)")).toBe(false);
    expect(isScripty("table t")).toBe(false);
  });

  it("DO blocks, multi-statement, and writes are scripty", () => {
    expect(isScripty("do $$ begin end $$")).toBe(true);
    expect(isScripty("select 1; select 2")).toBe(true);
    expect(isScripty("update t set a = 1")).toBe(true);
    expect(isScripty("insert into t values (1)")).toBe(true);
    expect(isScripty("create index on t (a)")).toBe(true);
  });

  it("a single trailing semicolon does not make a statement scripty", () => {
    expect(isScripty("select 1;")).toBe(false);
    expect(isScripty("select 1; ")).toBe(false);
  });
});

describe("collectRelations", () => {
  it("collects unique relation names across the tree", () => {
    const tree = node("orders", [node(null, [node("users")]), node("orders"), node("items")]);
    expect(collectRelations(tree).sort()).toEqual(["items", "orders", "users"]);
  });

  it("returns empty for relation-free plans", () => {
    expect(collectRelations(node(null))).toEqual([]);
  });
});

describe("fmtBytes", () => {
  it("formats binary units", () => {
    expect(fmtBytes(null)).toBe("—");
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1024)).toBe("1.0 KiB");
    expect(fmtBytes(1536)).toBe("1.5 KiB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    expect(fmtBytes(3 * 1024 ** 3)).toBe("3.0 GiB");
  });
});

describe("cn", () => {
  it("merges conflicting tailwind classes, last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});
