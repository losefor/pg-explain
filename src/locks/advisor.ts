import type { Diagnostic, PlanNode, PlanTree, Severity } from "../core/model.ts";
import { walk } from "../core/parse.ts";

const DOCS = "https://www.postgresql.org/docs/current";

/**
 * Static lock analysis from the SQL text (+ optional plan). PostgreSQL's EXPLAIN
 * does not show locks, so these findings come from the statement shape and node
 * types. Each is an actionable Diagnostic with a PGX_LOCK_* code.
 */
export function analyzeLocks(sql: string, tree?: PlanTree): Diagnostic[] {
  const code = stripSql(sql);
  const upper = code.toUpperCase();
  const kw = (code.trim().split(/\s+/)[0] ?? "").toUpperCase();
  const out: Diagnostic[] = [];

  const add = (
    id: string,
    severity: Severity,
    parts: {
      title: string;
      detail: string;
      cause: string;
      fix: string;
      commands?: { label?: string; sql?: string; shell?: string }[];
    },
  ): void => {
    out.push({
      code: id,
      domain: "plan",
      severity,
      title: parts.title,
      detail: parts.detail,
      cause: parts.cause,
      remediation: { summary: parts.fix, commands: parts.commands },
      docsUrl: `${DOCS}/explicit-locking.html`,
    });
  };

  // Table-rewriting operations → ACCESS EXCLUSIVE for the whole rewrite.
  if (
    /\bVACUUM\s+FULL\b/.test(upper) ||
    /\bCLUSTER\b/.test(upper) ||
    /\bALTER\s+TABLE\b[\s\S]*\b(TYPE|SET\s+DATA\s+TYPE)\b/.test(upper)
  ) {
    add("PGX_LOCK_TABLE_REWRITE", "error", {
      title: "Operation rewrites the table under an ACCESS EXCLUSIVE lock",
      detail:
        "VACUUM FULL / CLUSTER / a column-type change rewrites the whole table and holds ACCESS EXCLUSIVE for the duration.",
      cause:
        "ACCESS EXCLUSIVE blocks every reader and writer until the rewrite finishes — an outage on a busy table.",
      fix: "Avoid the full rewrite: use pg_repack for bloat instead of VACUUM FULL/CLUSTER; for type changes, add a new column, backfill in batches, and swap. Always do rewrites off-peak with a lock_timeout.",
      commands: [{ label: "Bound the wait", sql: "SET lock_timeout = '3s';" }],
    });
  }

  // CREATE/DROP INDEX without CONCURRENTLY.
  if (/\bCREATE\s+(UNIQUE\s+)?INDEX\b/.test(upper) && !/\bCONCURRENTLY\b/.test(upper)) {
    add("PGX_DDL_NO_CONCURRENTLY", "warn", {
      title: "CREATE INDEX without CONCURRENTLY blocks writes",
      detail:
        "A plain CREATE INDEX takes a SHARE lock, blocking all writes to the table until the build completes.",
      cause:
        "On a large or busy table the build can take minutes, during which inserts/updates/deletes are blocked.",
      fix: "Build the index online with CONCURRENTLY (note: it cannot run inside a transaction and may leave an INVALID index on failure, which you then drop and recreate).",
      commands: [{ label: "Build online", sql: "CREATE INDEX CONCURRENTLY ON <table> (<cols>);" }],
    });
  }
  if (/\bDROP\s+INDEX\b/.test(upper) && !/\bCONCURRENTLY\b/.test(upper)) {
    add("PGX_DROP_INDEX_NO_CONCURRENTLY", "warn", {
      title: "DROP INDEX without CONCURRENTLY takes ACCESS EXCLUSIVE",
      detail: "A plain DROP INDEX locks the table with ACCESS EXCLUSIVE.",
      cause: "Readers and writers block until the drop completes.",
      fix: "Use DROP INDEX CONCURRENTLY to avoid blocking.",
      commands: [{ label: "Drop online", sql: "DROP INDEX CONCURRENTLY <index>;" }],
    });
  }

  // TRUNCATE / LOCK TABLE.
  if (/\bTRUNCATE\b/.test(upper)) {
    add("PGX_LOCK_TRUNCATE", "info", {
      title: "TRUNCATE takes an ACCESS EXCLUSIVE lock",
      detail: "TRUNCATE briefly locks the table with ACCESS EXCLUSIVE.",
      cause:
        "It is fast (no row scan) but still blocks all access while it runs and is transactional.",
      fix: "Fine for maintenance windows; on a hot table, set a lock_timeout so it fails fast instead of queueing behind/ahead of other transactions.",
      commands: [{ label: "Bound the wait", sql: "SET lock_timeout = '3s';" }],
    });
  }
  if (/\bLOCK\s+TABLE\b/.test(upper)) {
    add("PGX_LOCK_TABLE_EXPLICIT", "info", {
      title: "Explicit LOCK TABLE",
      detail:
        "An explicit LOCK TABLE acquires the named lock mode for the rest of the transaction.",
      cause: "Holding a strong lock longer than necessary blocks other sessions.",
      fix: "Use the lowest lock mode that suffices and keep the transaction short.",
    });
  }

  // SELECT … FOR UPDATE/SHARE without a LIMIT → locks every matched row.
  if (
    /\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/.test(upper) &&
    !/\bLIMIT\b/.test(upper)
  ) {
    add("PGX_SELECT_FOR_UPDATE_UNBOUNDED", "warn", {
      title: "Row-locking SELECT without a LIMIT",
      detail:
        "SELECT … FOR UPDATE/SHARE locks every row it matches, held until the transaction ends.",
      cause:
        "Locking an unbounded set increases contention and deadlock risk with concurrent updaters.",
      fix: "Bound the set with a deterministic ORDER BY + LIMIT (and process in batches); a consistent lock order also avoids deadlocks.",
      commands: [{ label: "Bound + order", sql: "SELECT … ORDER BY id FOR UPDATE LIMIT 100;" }],
    });
  }

  // UPDATE/DELETE risks.
  if (kw === "UPDATE" || kw === "DELETE") {
    if (!/\bWHERE\b/.test(upper)) {
      add("PGX_WRITE_NO_WHERE", "warn", {
        title: `${kw} without a WHERE clause locks every row`,
        detail: `This ${kw} touches the whole table, taking a row lock on every row until commit.`,
        cause:
          "All rows are locked for the transaction's duration, blocking concurrent writers and bloating the table.",
        fix: "Add a WHERE clause; for large rewrites, update in batches (e.g. by primary-key ranges) and commit between batches.",
      });
    } else if (tree && hasSeqScanOnTarget(tree, targetTable(code, kw))) {
      const rel = targetTable(code, kw);
      add("PGX_UPDATE_UNINDEXED_PREDICATE", "warn", {
        title: `${kw} scans ${rel ?? "the table"} sequentially to find rows`,
        detail: `The plan uses a Seq Scan on ${rel ?? "the target table"}, so the ${kw} reads (and locks the touched rows of) the whole table.`,
        cause:
          "An unindexed predicate means more rows scanned and locked, and the locks are held until commit.",
        fix: `Index the ${kw}'s WHERE columns so it finds rows via an index and locks only what it changes.`,
        commands: [
          {
            label: "Index the predicate",
            sql: `CREATE INDEX ON ${rel ?? "<table>"} (<where columns>);`,
          },
        ],
      });
    }
  }

  // Generic DDL → recommend a lock_timeout so a blocked DDL can't queue and block everything behind it.
  if (
    /^(ALTER|CREATE|DROP)\b/.test(kw) &&
    !/\bCONCURRENTLY\b/.test(upper) &&
    !/\bSET\s+LOCK_TIMEOUT\b/.test(upper)
  ) {
    add("PGX_DDL_NO_LOCK_TIMEOUT", "warn", {
      title: "DDL without a lock_timeout can stall the whole table",
      detail:
        "This DDL needs a strong lock; if it waits behind a long transaction, every query that arrives after it also queues behind the DDL.",
      cause:
        "A blocked ACCESS EXCLUSIVE request sits at the head of the lock queue and blocks new readers/writers too.",
      fix: "Set a short lock_timeout before the DDL and retry, so it fails fast instead of forming a queue.",
      commands: [
        {
          label: "Fail fast, then retry",
          sql: "SET lock_timeout = '3s';\n-- run the DDL; on timeout, retry later",
        },
      ],
    });
  }

  // Attach a node location to the seq-scan finding where we can.
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Remove comments, string literals, and quoted identifiers so keyword regexes only see code. */
function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '"x"');
}

function targetTable(code: string, kw: string): string | undefined {
  const re =
    kw === "DELETE"
      ? /\bDELETE\s+FROM\s+([A-Za-z_][\w.]*)/i
      : /\bUPDATE\s+(?:ONLY\s+)?([A-Za-z_][\w.]*)/i;
  const m = re.exec(code);
  return m?.[1];
}

function hasSeqScanOnTarget(tree: PlanTree, table?: string): boolean {
  let found = false;
  walk(tree.root, (n: PlanNode) => {
    if (n.nodeType === "Seq Scan" && (!table || n.relationName === bareName(table))) found = true;
  });
  return found;
}

function bareName(qualified: string): string {
  const parts = qualified.split(".");
  return parts[parts.length - 1] ?? qualified;
}
