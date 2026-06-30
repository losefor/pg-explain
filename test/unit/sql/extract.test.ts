import { describe, expect, it } from "vitest";
import { classifyStatement, extractAnalyzableUnits } from "../../../src/sql/extract.ts";

const USER_DO = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'national_id_card' AND column_name = '_first_name'
  ) THEN
    UPDATE national_id_card
    SET first_name = COALESCE(NULLIF(first_name, ''), NULLIF("_first_name", ''), NULLIF(split_part(trim(fullname), ' ', 1), '')),
        middle_name = COALESCE(NULLIF(middle_name, ''), NULLIF("_father_name", ''));
  ELSE
    UPDATE national_id_card
    SET first_name = COALESCE(NULLIF(first_name, ''), NULLIF(split_part(trim(fullname), ' ', 1), ''));
  END IF;
END $$;`;

describe("classifyStatement", () => {
  it("classifies the major statement shapes", () => {
    expect(classifyStatement("SELECT 1")).toBe("explainable");
    expect(classifyStatement("UPDATE t SET a = 1")).toBe("explainable");
    expect(classifyStatement("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("explainable");
    expect(classifyStatement("DO $$ BEGIN END $$")).toBe("do-block");
    expect(classifyStatement("CALL do_thing()")).toBe("utility");
    expect(classifyStatement("ALTER TABLE t ADD COLUMN c int")).toBe("utility");
    expect(classifyStatement("VACUUM t")).toBe("utility");
    expect(classifyStatement("   ")).toBe("empty");
  });
  it("is not fooled by keywords inside string literals", () => {
    expect(classifyStatement("SELECT 'DO $$' AS note")).toBe("explainable");
  });
});

describe("extractAnalyzableUnits — DO block", () => {
  const units = extractAnalyzableUnits(USER_DO);

  it("extracts both IF/ELSE branch UPDATEs", () => {
    const explainable = units.filter((u) => u.kind === "explainable");
    expect(explainable).toHaveLength(2);
    expect(explainable[0]?.label).toContain("IF-branch");
    expect(explainable[0]?.label).toContain("national_id_card");
    expect(
      explainable[0]?.kind === "explainable" &&
        explainable[0].sql.startsWith("UPDATE national_id_card"),
    ).toBe(true);
    expect(explainable[1]?.label).toContain("ELSE-branch");
    // The control scaffolding is stripped — no IF/THEN/ELSE/END left in the extracted SQL.
    expect(
      explainable[0]?.kind === "explainable" &&
        /\b(IF|THEN|ELSE|END)\b/i.test(explainable[0].sql.replace(/'[^']*'/g, "")),
    ).toBe(false);
  });
});

describe("extractAnalyzableUnits — scripts & edge cases", () => {
  it("splits a multi-statement script and flags utility statements", () => {
    const u = extractAnalyzableUnits("SELECT 1; UPDATE t SET a = 1; VACUUM t;");
    expect(u.filter((x) => x.kind === "explainable")).toHaveLength(2);
    const skipped = u.find((x) => x.kind === "skipped");
    expect(skipped?.kind === "skipped" && skipped.reason).toMatch(/VACUUM/);
  });

  it("flags dynamic EXECUTE inside a DO block as skipped", () => {
    const u = extractAnalyzableUnits("DO $$ BEGIN EXECUTE 'UPDATE ' || t || ' SET a=1'; END $$;");
    expect(u.some((x) => x.kind === "skipped" && /dynamic/i.test(x.reason))).toBe(true);
  });

  it("notes loop bodies", () => {
    const u = extractAnalyzableUnits(
      "DO $$ BEGIN FOR i IN 1..10 LOOP INSERT INTO t VALUES (i); END LOOP; END $$;",
    );
    const ins = u.find((x) => x.kind === "explainable");
    expect(ins?.kind === "explainable" && ins.loopNote).toBeTruthy();
    expect(ins?.kind === "explainable" && ins.sql.startsWith("INSERT INTO t")).toBe(true);
  });

  it("treats a bare statement as one unit", () => {
    const u = extractAnalyzableUnits("UPDATE orders SET status = 'x' WHERE id = 1");
    expect(u).toHaveLength(1);
    expect(u[0]?.label).toBe("UPDATE orders");
  });
});
