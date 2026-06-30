import { splitStatements } from "../db/explain.ts";

/**
 * Pull the EXPLAIN-able SQL out of arbitrary input — a single statement, a
 * multi-statement script, or a `DO $$ … $$` / PL-pgSQL block — so each piece can be
 * cost-only analyzed. EXPLAIN cannot target a DO block, CALL, SET, DDL, or multiple
 * statements at once, so we extract the top-level DML and report the rest as skipped.
 *
 * ponytail: pragmatic extractor, not a full PL/pgSQL parser. It handles IF/ELSE/LOOP/
 * BEGIN wrappers and flags what it can't statically resolve (dynamic EXECUTE); exotic
 * nesting falls back to "skipped" rather than guessing.
 */
export type AnalyzableUnit =
  | { kind: "explainable"; label: string; sql: string; loopNote?: string }
  | { kind: "skipped"; label: string; reason: string };

const DML = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "VALUES", "TABLE", "WITH"]);

export function classifyStatement(sql: string): "explainable" | "do-block" | "utility" | "empty" {
  const kw = firstKeyword(sql);
  if (!kw) return "empty";
  if (kw === "DO") return "do-block";
  if (DML.has(kw) || kw === "EXECUTE") return "explainable"; // top-level EXECUTE = a prepared statement
  return "utility";
}

/** Split arbitrary SQL input into analyzable units (DML) + skipped notes. */
export function extractAnalyzableUnits(sql: string): AnalyzableUnit[] {
  const units: AnalyzableUnit[] = [];
  for (const stmt of splitStatements(sql)) {
    const cls = classifyStatement(stmt);
    if (cls === "empty") continue;
    if (cls === "explainable") {
      units.push({ kind: "explainable", label: unitLabel(stmt), sql: stmt });
    } else if (cls === "do-block") {
      units.push(...extractFromDo(stmt));
    } else {
      const kw = firstKeyword(stmt);
      units.push({
        kind: "skipped",
        label: `${kw} …`,
        reason: `EXPLAIN cannot analyze a ${kw} statement (it is a utility/transaction-control command, not an optimizable query).`,
      });
    }
  }
  return units;
}

function extractFromDo(doSql: string): AnalyzableUnit[] {
  const body = dollarBody(doSql);
  if (body === null) {
    return [
      { kind: "skipped", label: "DO block", reason: "Could not find the block body ($$ … $$)." },
    ];
  }
  const out: AnalyzableUnit[] = [];
  for (const frag of splitStatements(body)) {
    const stripped = stripControl(frag);
    if (!stripped) continue; // pure control flow / assignment / RAISE / END
    const kw = firstKeyword(stripped.sql);
    if (kw === "EXECUTE") {
      out.push({
        kind: "skipped",
        label: `${stripped.context}EXECUTE (dynamic SQL)`,
        reason:
          "Dynamic SQL built at runtime — the statement text isn't known statically, so it can't be analyzed.",
      });
      continue;
    }
    if (DML.has(kw)) {
      const unit: AnalyzableUnit = {
        kind: "explainable",
        label: stripped.context + unitLabel(stripped.sql),
        sql: stripped.sql,
      };
      if (stripped.loop) unit.loopNote = "runs once per loop iteration in the block";
      out.push(unit);
    }
    // anything else (variable assignment, RAISE, PERFORM-less control) is silently skipped
  }
  if (out.length === 0) {
    out.push({
      kind: "skipped",
      label: "DO block",
      reason: "No top-level DML statements found to analyze.",
    });
  }
  return out;
}

/** Strip leading PL/pgSQL control wrappers (IF/ELSIF/ELSE/LOOP/FOR/WHILE/BEGIN/THEN). */
function stripControl(frag: string): { context: string; sql: string; loop: boolean } | null {
  let rest = frag;
  let context = "";
  let loop = false;

  for (let guard = 0; guard < 8; guard++) {
    rest = rest.replace(/^\s+/, "");
    const masked = maskNonCode(rest);
    const kw = (/^[A-Za-z_]+/.exec(masked)?.[0] ?? "").toUpperCase();

    if (kw === "IF" || kw === "ELSIF") {
      const then = /\bTHEN\b/i.exec(masked);
      if (!then) break;
      context += kw === "IF" ? "IF-branch › " : "ELSIF-branch › ";
      rest = rest.slice(then.index + 4);
    } else if (kw === "ELSE") {
      context += "ELSE-branch › ";
      rest = rest.replace(/^\s*ELSE\b/i, "");
    } else if (kw === "FOR" || kw === "WHILE") {
      const lp = /\bLOOP\b/i.exec(masked);
      if (!lp) break;
      loop = true;
      context += "loop › ";
      rest = rest.slice(lp.index + 4);
    } else if (kw === "LOOP") {
      loop = true;
      context += "loop › ";
      rest = rest.replace(/^\s*LOOP\b/i, "");
    } else if (kw === "BEGIN" || kw === "THEN") {
      rest = rest.replace(/^\s*(BEGIN|THEN)\b/i, "");
    } else {
      break;
    }
  }

  rest = rest.replace(/^\s+/, "").replace(/;\s*$/, "").trim();
  if (!rest) return null;

  const kw = firstKeyword(rest);
  if (kw === "PERFORM") return { context, sql: rest.replace(/^\s*PERFORM\b/i, "SELECT"), loop };
  if (DML.has(kw) || kw === "EXECUTE") return { context, sql: rest, loop };
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function firstKeyword(sql: string): string {
  const m = /^[A-Za-z_]+/.exec(maskNonCode(sql).trim());
  return m ? m[0].toUpperCase() : "";
}

function unitLabel(stmt: string): string {
  const kw = firstKeyword(stmt);
  const t = targetTable(stmt, kw);
  return t ? `${kw} ${t}` : kw || "statement";
}

function targetTable(stmt: string, kw: string): string | undefined {
  const re =
    kw === "DELETE"
      ? /\bDELETE\s+FROM\s+([A-Za-z_][\w.]*)/i
      : kw === "INSERT"
        ? /\bINSERT\s+INTO\s+([A-Za-z_][\w.]*)/i
        : kw === "UPDATE"
          ? /\bUPDATE\s+(?:ONLY\s+)?([A-Za-z_][\w.]*)/i
          : undefined;
  return re ? (re.exec(stmt)?.[1] ?? undefined) : undefined;
}

/** Extract the text between the first dollar-quote tag and its match. */
function dollarBody(doSql: string): string | null {
  const m = /\$([A-Za-z_]*)\$/.exec(doSql);
  if (!m) return null;
  const tag = m[0];
  const start = m.index + tag.length;
  const end = doSql.indexOf(tag, start);
  return end < 0 ? null : doSql.slice(start, end);
}

/**
 * Return a same-length copy of `sql` with the contents of comments, string
 * literals, quoted identifiers, and dollar-quoted bodies replaced by spaces — so
 * keyword/`;`/`THEN` detection never trips on text inside a literal. Offsets are
 * preserved so callers can slice the original.
 */
function maskNonCode(sql: string): string {
  const out = sql.split("");
  const n = sql.length;
  let i = 0;
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      let j = sql.indexOf("\n", i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
    } else if (two === "/*") {
      let j = sql.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j);
      i = j;
    } else if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i];
      let j = i + 1;
      while (j < n) {
        if (sql[j] === q) {
          if (sql[j + 1] === q) j += 2;
          else {
            j++;
            break;
          }
        } else j++;
      }
      blank(i, j);
      i = j;
    } else if (sql[i] === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        let j = sql.indexOf(tag, i + tag.length);
        j = j < 0 ? n : j + tag.length;
        blank(i, j);
        i = j;
      } else i++;
    } else i++;
  }
  return out.join("");
}
