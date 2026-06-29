import { describe, expect, it } from "vitest";
import { analyzeLocks } from "../../../src/locks/advisor.ts";
import { loadTree } from "../helpers.ts";

const codes = (sql: string, tree?: Parameters<typeof analyzeLocks>[1]) =>
  analyzeLocks(sql, tree).map((d) => d.code);

describe("analyzeLocks", () => {
  it("flags table-rewriting operations as critical", () => {
    const found = analyzeLocks("VACUUM FULL orders");
    expect(found[0]?.code).toBe("PGX_LOCK_TABLE_REWRITE");
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.remediation.summary).toMatch(/pg_repack|batch/i);
  });

  it("flags CREATE INDEX without CONCURRENTLY", () => {
    const c = codes("CREATE INDEX ON orders (status)");
    expect(c).toContain("PGX_DDL_NO_CONCURRENTLY");
    expect(c).toContain("PGX_DDL_NO_LOCK_TIMEOUT");
  });

  it("does not flag CONCURRENTLY index builds", () => {
    expect(codes("CREATE INDEX CONCURRENTLY ON orders (status)")).not.toContain(
      "PGX_DDL_NO_CONCURRENTLY",
    );
  });

  it("flags UPDATE/DELETE without WHERE", () => {
    expect(codes("UPDATE orders SET x = 1")).toContain("PGX_WRITE_NO_WHERE");
    expect(codes("DELETE FROM orders")).toContain("PGX_WRITE_NO_WHERE");
  });

  it("flags a DELETE that seq-scans its target table", () => {
    const tree = loadTree("seq-scan-large.json"); // Seq Scan on orders
    expect(codes("DELETE FROM orders WHERE status = 'x'", tree)).toContain(
      "PGX_UPDATE_UNINDEXED_PREDICATE",
    );
  });

  it("flags unbounded FOR UPDATE", () => {
    expect(codes("SELECT * FROM orders FOR UPDATE")).toContain("PGX_SELECT_FOR_UPDATE_UNBOUNDED");
    expect(codes("SELECT * FROM orders ORDER BY id FOR UPDATE LIMIT 10")).not.toContain(
      "PGX_SELECT_FOR_UPDATE_UNBOUNDED",
    );
  });

  it("does not match keywords inside string literals", () => {
    expect(analyzeLocks("SELECT 'VACUUM FULL is scary' AS note")).toHaveLength(0);
  });

  it("is quiet for a plain SELECT", () => {
    expect(analyzeLocks("SELECT 1")).toHaveLength(0);
  });
});
