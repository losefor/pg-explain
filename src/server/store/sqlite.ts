import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

/** Where the studio keeps its local data (override with PGEXPLAIN_DATA_DIR). */
export function dataDir(): string {
  return process.env.PGEXPLAIN_DATA_DIR ?? join(homedir(), ".pgexplain");
}

export interface ConnectionInput {
  name: string;
  dsn?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Stored only if the user opts in; never returned by the API. */
  password?: string;
  sslmode?: string;
  sslrootcert?: string;
}

/** A connection as exposed by the API — password is replaced by a boolean. */
export interface ConnectionPublic extends Omit<ConnectionInput, "password"> {
  id: string;
  hasPassword: boolean;
  createdAt: number;
}

export interface RunInput {
  kind: "analyze" | "run";
  connectionId?: string | null;
  sql?: string | null;
  /** Raw EXPLAIN JSON, kept so two runs can be re-analyzed and diffed. */
  planText?: string | null;
  verdict: string;
  worstSeverity: string | null;
  execMs: number | null;
  counts: { error: number; warn: number; info: number };
  report: Record<string, unknown>;
}

export interface RunSummary {
  id: string;
  createdAt: number;
  kind: "analyze" | "run";
  connectionId: string | null;
  label: string | null;
  starred: boolean;
  baseline: boolean;
  sql: string | null;
  verdict: string;
  worstSeverity: string | null;
  execMs: number | null;
  counts: { error: number; warn: number; info: number };
}

export interface RunRecord extends RunSummary {
  report: Record<string, unknown>;
  planText: string | null;
}

type Row = Record<string, unknown>;

export interface Store {
  listConnections(): ConnectionPublic[];
  getConnection(id: string): (ConnectionInput & { id: string }) | null;
  createConnection(input: ConnectionInput): ConnectionPublic;
  updateConnection(id: string, input: ConnectionInput): ConnectionPublic | null;
  deleteConnection(id: string): boolean;

  insertRun(input: RunInput): RunRecord;
  listRuns(limit?: number): RunSummary[];
  getRun(id: string): RunRecord | null;
  deleteRun(id: string): boolean;
  updateRun(
    id: string,
    patch: { starred?: boolean; label?: string | null; baseline?: boolean },
  ): RunSummary | null;

  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, dsn TEXT, host TEXT, port INTEGER,
  database TEXT, "user" TEXT, password TEXT, sslmode TEXT, sslrootcert TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, kind TEXT NOT NULL,
  connection_id TEXT, label TEXT, starred INTEGER NOT NULL DEFAULT 0,
  baseline INTEGER NOT NULL DEFAULT 0, sql TEXT, verdict TEXT,
  worst_severity TEXT, exec_ms REAL, counts TEXT NOT NULL, report TEXT NOT NULL,
  plan_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
`;

/** Open (and migrate) the studio SQLite database. */
export function openStore(file?: string): Store {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const db = new Database(file ?? join(dir, "studio.db"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  // Migrate older databases that predate the plan_text column.
  const runCols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!runCols.some((c) => c.name === "plan_text"))
    db.exec("ALTER TABLE runs ADD COLUMN plan_text TEXT");

  const connToPublic = (r: Row): ConnectionPublic => ({
    id: r.id as string,
    name: r.name as string,
    dsn: (r.dsn as string) ?? undefined,
    host: (r.host as string) ?? undefined,
    port: (r.port as number) ?? undefined,
    database: (r.database as string) ?? undefined,
    user: (r.user as string) ?? undefined,
    sslmode: (r.sslmode as string) ?? undefined,
    sslrootcert: (r.sslrootcert as string) ?? undefined,
    hasPassword: !!r.password,
    createdAt: r.created_at as number,
  });

  const runToSummary = (r: Row): RunSummary => ({
    id: r.id as string,
    createdAt: r.created_at as number,
    kind: r.kind as "analyze" | "run",
    connectionId: (r.connection_id as string) ?? null,
    label: (r.label as string) ?? null,
    starred: !!r.starred,
    baseline: !!r.baseline,
    sql: (r.sql as string) ?? null,
    verdict: (r.verdict as string) ?? "",
    worstSeverity: (r.worst_severity as string) ?? null,
    execMs: (r.exec_ms as number) ?? null,
    counts: JSON.parse((r.counts as string) ?? '{"error":0,"warn":0,"info":0}'),
  });

  return {
    listConnections: () =>
      (db.prepare("SELECT * FROM connections ORDER BY created_at DESC").all() as Row[]).map(
        connToPublic,
      ),

    getConnection: (id) => {
      const r = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row | undefined;
      if (!r) return null;
      return {
        id: r.id as string,
        name: r.name as string,
        dsn: (r.dsn as string) ?? undefined,
        host: (r.host as string) ?? undefined,
        port: (r.port as number) ?? undefined,
        database: (r.database as string) ?? undefined,
        user: (r.user as string) ?? undefined,
        password: (r.password as string) ?? undefined,
        sslmode: (r.sslmode as string) ?? undefined,
        sslrootcert: (r.sslrootcert as string) ?? undefined,
      };
    },

    createConnection: (input) => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO connections (id,name,dsn,host,port,database,"user",password,sslmode,sslrootcert,created_at)
         VALUES (@id,@name,@dsn,@host,@port,@database,@user,@password,@sslmode,@sslrootcert,@createdAt)`,
      ).run(normalizeConn({ id, createdAt, ...input }));
      return connToPublic(db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row);
    },

    updateConnection: (id, input) => {
      const exists = db.prepare("SELECT id FROM connections WHERE id = ?").get(id);
      if (!exists) return null;
      db.prepare(
        `UPDATE connections SET name=@name,dsn=@dsn,host=@host,port=@port,database=@database,
         "user"=@user,password=@password,sslmode=@sslmode,sslrootcert=@sslrootcert WHERE id=@id`,
      ).run(normalizeConn({ id, createdAt: 0, ...input }));
      return connToPublic(db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as Row);
    },

    deleteConnection: (id) =>
      db.prepare("DELETE FROM connections WHERE id = ?").run(id).changes > 0,

    insertRun: (input) => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO runs (id,created_at,kind,connection_id,label,starred,baseline,sql,verdict,worst_severity,exec_ms,counts,report,plan_text)
         VALUES (@id,@createdAt,@kind,@connectionId,NULL,0,0,@sql,@verdict,@worstSeverity,@execMs,@counts,@report,@planText)`,
      ).run({
        id,
        createdAt,
        kind: input.kind,
        connectionId: input.connectionId ?? null,
        sql: input.sql ?? null,
        verdict: input.verdict,
        worstSeverity: input.worstSeverity,
        execMs: input.execMs,
        counts: JSON.stringify(input.counts),
        report: JSON.stringify(input.report),
        planText: input.planText ?? null,
      });
      return getRun(db, id) as RunRecord;
    },

    listRuns: (limit = 200) =>
      (db.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(
        runToSummary,
      ),

    getRun: (id) => getRun(db, id),

    deleteRun: (id) => db.prepare("DELETE FROM runs WHERE id = ?").run(id).changes > 0,

    updateRun: (id, patch) => {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
      if (!r) return null;
      // A single baseline at a time.
      if (patch.baseline === true) db.prepare("UPDATE runs SET baseline = 0").run();
      db.prepare(
        "UPDATE runs SET starred = COALESCE(@starred, starred), label = COALESCE(@label, label), baseline = COALESCE(@baseline, baseline) WHERE id = @id",
      ).run({
        id,
        starred: patch.starred === undefined ? null : patch.starred ? 1 : 0,
        label: patch.label === undefined ? null : patch.label,
        baseline: patch.baseline === undefined ? null : patch.baseline ? 1 : 0,
      });
      return runToSummary(db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row);
    },

    close: () => db.close(),
  };

  function getRun(database: Database.Database, id: string): RunRecord | null {
    const r = database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return {
      ...runToSummary(r),
      report: JSON.parse(r.report as string),
      planText: (r.plan_text as string) ?? null,
    };
  }
}

function normalizeConn(c: ConnectionInput & { id: string; createdAt: number }): Row {
  return {
    id: c.id,
    name: c.name,
    dsn: c.dsn ?? null,
    host: c.host ?? null,
    port: c.port ?? null,
    database: c.database ?? null,
    user: c.user ?? null,
    password: c.password ?? null,
    sslmode: c.sslmode ?? null,
    sslrootcert: c.sslrootcert ?? null,
    createdAt: c.createdAt,
  };
}
