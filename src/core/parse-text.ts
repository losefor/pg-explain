/**
 * Plain-text `EXPLAIN [ANALYZE]` parser (psql / pgAdmin output).
 *
 * Ported from pev2's text parser (Dalibo, PostgreSQL license) —
 * https://github.com/dalibo/pev2 `src/services/plan-service.ts` `fromText`/`splitIntoLines`.
 * Rather than build a bespoke node type, this emits `RawPlan` objects keyed with the SAME
 * names PostgreSQL uses in `FORMAT JSON` (`"Node Type"`, `"Actual Rows"`, `"Shared Hit Blocks"`, …)
 * and hands them to the existing `normalizeNode` via `statementToTree` — so text and JSON plans
 * flow through one normalization path and behave identically downstream.
 *
 * Unlike pev2 (which keeps `"Seq Scan on orders"` as the node label), we split the scan target
 * out of the type line into `Relation Name` / `Index Name` / `Schema` / `Alias`, matching JSON,
 * so advisor rules that match `nodeType === "Seq Scan"` fire on text plans too.
 */

import type { RawPlan } from "./model.ts";
import type { RawStatement } from "./parse.ts";

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

const numeric = (v: string): string | number => {
  const t = v.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

/** Split a projection/key list on top-level commas (parenthesis-aware). */
function splitList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Rejoin lines that a fixed-width terminal / pgAdmin has force-wrapped. Faithful port of pev2's
 * `splitIntoLines`: a line continues the previous one when parentheses are unbalanced, when it
 * starts with `(`, or when the previous info line ended in a comma at a different indent.
 */
function splitIntoLines(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  const count = (s: string, re: RegExp) => (s.match(re) || []).length;
  const closingFirst = (s: string) => {
    const c = s.indexOf(")");
    const o = s.indexOf("(");
    return c !== -1 && c < o;
  };
  const sameIndent = (a: string, b: string) => a.search(/\S/) === b.search(/\S/);

  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && count(prev, /\)/g) !== count(prev, /\(/g)) {
      out[out.length - 1] += line;
    } else if (
      /^(?:Total\s+runtime|Planning(\s+time)?|Execution\s+time|Time|Filter|Output|JIT|Trigger|Settings|Serialization)/i.test(
        line,
      )
    ) {
      out.push(line);
    } else if (/^\S/.test(line) || /^\s*\(/.test(line) || closingFirst(line)) {
      // A col-0 line rejoins a force-wrapped previous line — but never across a blank
      // separator, which delimits statements.
      if (prev) out[out.length - 1] += line;
      else out.push(line);
    } else if (prev && /,\s*$/.test(prev) && !sameIndent(prev, line) && !/^\s*->/i.test(line)) {
      out[out.length - 1] += line;
    } else {
      out.push(line);
    }
  }
  return out;
}

// ── the node line: `-> [Partial ]Type on rel  (cost=… rows=… width=…) (actual …|never executed)` ──

const estimation = String.raw`\(cost=(\d+\.\d+)\.\.(\d+\.\d+)\s+rows=(\d+)\s+width=(\d+)\)`;
const actual = String.raw`(?:actual(?:\stime=(\d+\.\d+)\.\.(\d+\.\d+))?\srows=(\d+(?:\.\d+)?)\sloops=(\d+)|(never\s+executed))`;
const nodeRe = new RegExp(
  String.raw`^(\s*->\s*|\s*)(Finalize|Simple|Partial)*\s*([^\r\n\t\f\v(]*?)\s*` +
    String.raw`(?:(?:${estimation}\s+\(${actual}\))|(?:${estimation})|(?:\(${actual}\)))\s*$`,
);
// Node-line capture groups (mirrors pev2's NodeMatch): 1 prefix, 2 partial, 3 type,
// 4-7 cost/rows/width (branch A), 8-12 actual (branch A, 12=never), 13-16 (branch B), 17-21 (branch C).

const subRe = /^((?:Sub|Init)Plan)\s*(?:\d+\s*)?(?:\(returns.*\))?\s*$/;
const cteRe = /^CTE\s+(\S+)\s*$/;
const workerRe =
  /^Worker\s+(\d+):\s+(?:actual(?:\stime=(\d+\.\d+)\.\.(\d+\.\d+))?\srows=(\d+(?:\.\d+)?)\sloops=(\d+)|never\s+executed)(.*)$/;
const triggerRe = /^Trigger\s+(.*):\s+time=(\d+\.\d+)\s+calls=(\d+)\s*$/;
const headerRe = /^(QUERY PLAN|-{2,}|#|\(\d+ rows?\))/;

/** Break `Index Scan using idx on public.orders o` into JSON-equivalent parts. */
function splitNodeType(text: string): Partial<RawPlan> & { "Node Type": string } {
  let s = text.trim();
  let indexName: string | undefined;
  let relationName: string | undefined;
  let schema: string | undefined;
  let alias: string | undefined;

  const using = s.match(/\susing (\S+)/);
  if (using?.[1]) {
    indexName = using[1];
    s = s.replace(using[0] ?? "", "");
  }
  const on = s.match(/\son (\S+?)(?:\s+(\S+))?\s*$/);
  if (on?.[1]) {
    let rel = on[1];
    alias = on[2];
    const dot = rel.lastIndexOf(".");
    if (dot !== -1) {
      schema = rel.slice(0, dot);
      rel = rel.slice(dot + 1);
    }
    relationName = rel;
    s = s.slice(0, on.index).trim();
  }
  // Postgres text prefixes "Parallel " onto the type; JSON keeps it in a separate flag. Drop it so
  // the normalized nodeType matches JSON (parallelism is still visible via Workers Planned/Launched).
  const nodeType = s.replace(/^Parallel\s+/, "").trim();

  // For a Bitmap Index Scan the `on <x>` target is the index, not a relation.
  if (nodeType === "Bitmap Index Scan" && relationName && !indexName) {
    indexName = relationName;
    relationName = undefined;
    schema = undefined;
    alias = undefined;
  }

  const out: Partial<RawPlan> & { "Node Type": string } = { "Node Type": nodeType };
  if (relationName) out["Relation Name"] = relationName;
  if (indexName) out["Index Name"] = indexName;
  if (schema) out.Schema = schema;
  if (alias && alias !== relationName) out.Alias = alias;
  return out;
}

// ── detail-line parsers → set JSON-keyed fields on the current node ────────────

function parseSort(text: string, node: RawPlan): boolean {
  const m = text.match(/^Sort Method:\s+(.*?)\s+(Memory|Disk):\s+(\S+)kB\s*$/);
  if (!m?.[1] || !m[2] || m[3] === undefined) return false;
  node["Sort Method"] = m[1].trim();
  node["Sort Space Type"] = m[2];
  node["Sort Space Used"] = Number(m[3]);
  return true;
}

function parseBuffers(text: string, node: RawPlan): boolean {
  const m = text.match(/^Buffers:\s+(.*)$/);
  if (!m?.[1]) return false;
  for (const group of m[1].split(/,\s+/)) {
    const g = group.match(/^(shared|temp|local)\s+(.*)$/);
    if (!g?.[1] || g[2] === undefined) continue;
    const type = cap(g[1]);
    for (const kv of g[2].trim().split(/\s+/)) {
      const [method, value] = kv.split("=");
      if (method && value !== undefined) node[`${type} ${cap(method)} Blocks`] = Number(value);
    }
  }
  return true;
}

function parseWal(text: string, node: RawPlan): boolean {
  const m = text.match(/^WAL:\s+(.*)$/);
  if (!m?.[1]) return false;
  for (const kv of m[1].trim().split(/\s+/)) {
    const [k, value] = kv.split("=");
    if (!k || value === undefined) continue;
    node[`WAL ${k === "fpi" ? "FPI" : cap(k)}`] = Number(value);
  }
  return true;
}

function parseIoTimings(text: string, node: RawPlan): boolean {
  const m = text.match(/^I\/O Timings:\s+(.*)$/);
  if (!m?.[1]) return false;
  const read = m[1].match(/(?:^|\s)read=(\d+(?:\.\d+)?)/);
  const write = m[1].match(/(?:^|\s)write=(\d+(?:\.\d+)?)/);
  if (read?.[1]) node["I/O Read Time"] = Number(read[1]);
  if (write?.[1]) node["I/O Write Time"] = Number(write[1]);
  return true;
}

/** `search_path = 'x', work_mem = '4MB'` → { search_path: "x", work_mem: "4MB" }. */
function parseSettings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of splitList(text)) {
    const m = pair.match(/^(\S+)\s*=\s*(.*)$/);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^'|'$/g, "");
  }
  return out;
}

const LIST_KEYS = new Set(["Output", "Sort Key", "Presorted Key", "Group Key"]);

interface Frame {
  depth: number;
  node: RawPlan;
  /** Set when this frame is a Sub/Init/CTE header; children get this relationship. */
  rel?: "SubPlan" | "InitPlan";
  name?: string;
}

/**
 * Parse plain-text EXPLAIN output into one or more `RawStatement` objects (the same shape JSON
 * yields before normalization). Multiple statements separated by blank lines each start a new tree.
 */
export function parseTextToStatements(input: string): RawStatement[] {
  const statements: RawStatement[] = [];
  let stmt: RawStatement | null = null;
  let stack: Frame[] = [];
  let current: RawPlan | null = null; // node that trailing detail lines attach to
  let jit: Record<string, unknown> | null = null; // active `JIT:` block, if any

  const finish = () => {
    if (stmt?.Plan) statements.push(stmt);
    stmt = null;
    stack = [];
    current = null;
    jit = null;
  };

  for (let raw of splitIntoLines(input)) {
    // pgAdmin wraps each line in quotes; tabs vary. Normalize, then measure indent.
    raw = raw.replace(/"\s*$/, "").replace(/^\s*"/, "").replace(/\t/g, "    ");
    const depth = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = raw.slice(depth);

    if (line === "" || headerRe.test(line)) {
      if (line === "" && stmt?.Plan) finish(); // blank line after a plan ends the statement
      continue;
    }

    const nodeM = nodeRe.exec(line);
    const subM = subRe.exec(line);
    const cteM = cteRe.exec(line);

    if (nodeM && !subM && !cteM) {
      if (!stmt) stmt = {} as RawStatement;
      jit = null;
      const node: RawPlan = { ...splitNodeType(nodeM[3] ?? "") };
      if (nodeM[2]) node["Partial Mode"] = nodeM[2];

      const startup = nodeM[4] ?? nodeM[13];
      const total = nodeM[5] ?? nodeM[14];
      if (startup && total) {
        node["Startup Cost"] = Number(startup);
        node["Total Cost"] = Number(total);
        node["Plan Rows"] = Number(nodeM[6] ?? nodeM[15]);
        node["Plan Width"] = Number(nodeM[7] ?? nodeM[16]);
      }
      const st = nodeM[8] ?? nodeM[17];
      const tt = nodeM[9] ?? nodeM[18];
      if (st && tt) {
        node["Actual Startup Time"] = Number(st);
        node["Actual Total Time"] = Number(tt);
      }
      const rows = nodeM[10] ?? nodeM[19];
      const loops = nodeM[11] ?? nodeM[20];
      if (rows && loops) {
        node["Actual Rows"] = Number(rows);
        node["Actual Loops"] = Number(loops);
      }
      if (nodeM[12] ?? nodeM[21]) {
        node["Actual Loops"] = 0;
        node["Actual Rows"] = 0;
      }

      // Attach to the tree.
      stack = stack.filter((f) => f.depth < depth);
      const parent = stack[stack.length - 1];
      if (!parent) {
        stmt.Plan = node;
      } else {
        if (parent.rel) {
          node["Parent Relationship"] = parent.rel;
          if (parent.name) node["Subplan Name"] = parent.name;
        }
        const parentNode = parent.node;
        if (!parentNode.Plans) parentNode.Plans = [];
        parentNode.Plans.push(node);
      }
      stack.push({ depth, node });
      current = node;
      continue;
    }

    if (subM || cteM) {
      stack = stack.filter((f) => f.depth < depth);
      const parent = stack[stack.length - 1];
      if (!parent) continue;
      if (cteM?.[1])
        stack.push({ depth, node: parent.node, rel: "InitPlan", name: `CTE ${cteM[1]}` });
      else if (subM?.[1])
        stack.push({
          depth,
          node: parent.node,
          rel: subM[1] as "SubPlan" | "InitPlan",
          name: (subM[0] ?? "").trim(),
        });
      continue;
    }

    const workerM = workerRe.exec(line);
    if (workerM && current) {
      const worker: Record<string, unknown> = { "Worker Number": Number(workerM[1]) };
      if (workerM[2] && workerM[3]) {
        worker["Actual Startup Time"] = Number(workerM[2]);
        worker["Actual Total Time"] = Number(workerM[3]);
      }
      if (workerM[4] && workerM[5]) {
        worker["Actual Rows"] = Number(workerM[4]);
        worker["Actual Loops"] = Number(workerM[5]);
      }
      if (!Array.isArray(current.Workers)) current.Workers = [];
      (current.Workers as Record<string, unknown>[]).push(worker);
      continue;
    }

    const trigM = triggerRe.exec(line);
    if (trigM && stmt) {
      if (!Array.isArray(stmt.Triggers)) stmt.Triggers = [];
      (stmt.Triggers as unknown[]).push({
        "Trigger Name": trigM[1],
        Time: Number(trigM[2]),
        Calls: Number(trigM[3]),
      });
      continue;
    }

    // key: value detail / statement-level line
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv?.[1]) continue;
    const key = kv[1].trim();
    const value = (kv[2] ?? "").trim();

    if (key === "JIT") {
      jit = {};
      if (stmt) stmt.JIT = jit;
      continue;
    }
    if (jit) {
      if (key === "Functions") jit.Functions = Number(value);
      else if (key === "Timing") {
        const timing: Record<string, unknown> = {};
        for (const part of value.split(/,\s*/)) {
          const t = part.match(/^(\S+)\s+(\d+\.\d+)\s*ms/);
          if (t?.[1]) timing[t[1]] = Number(t[2]);
        }
        jit.Timing = timing;
      }
      continue;
    }

    if (key === "Planning Time") {
      if (stmt) stmt["Planning Time"] = parseFloat(value);
      continue;
    }
    if (key === "Execution Time" || key === "Total runtime") {
      if (stmt) stmt["Execution Time"] = parseFloat(value);
      continue;
    }
    if (key === "Settings") {
      if (stmt) stmt.Settings = parseSettings(value);
      continue;
    }

    if (!current) continue;
    if (
      parseSort(line, current) ||
      parseBuffers(line, current) ||
      parseWal(line, current) ||
      parseIoTimings(line, current)
    ) {
      continue;
    }
    current[key] = LIST_KEYS.has(key) ? splitList(value) : numeric(value);
  }

  finish();
  return statements;
}
