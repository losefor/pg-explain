import { type ConnectionOptions, queryReadOnly } from "../db/client.ts";

export interface LiveLockSession {
  pid: number;
  user: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  ageSeconds: number | null;
  query: string | null;
  /** PIDs currently blocking this session (pg_blocking_pids). */
  blockedBy: number[];
}

export interface LiveLocks {
  sessions: LiveLockSession[];
  /** Just the sessions that are currently waiting on a lock. */
  blocked: LiveLockSession[];
  capturedAt: number;
}

const SQL = `
SELECT a.pid,
       a.usename                                        AS "user",
       a.state,
       a.wait_event_type                                AS "waitEventType",
       a.wait_event                                     AS "waitEvent",
       EXTRACT(EPOCH FROM (now() - a.query_start))      AS "ageSeconds",
       a.query,
       pg_blocking_pids(a.pid)                          AS "blockedBy"
FROM pg_stat_activity a
WHERE a.backend_type = 'client backend' AND a.pid <> pg_backend_pid()
ORDER BY cardinality(pg_blocking_pids(a.pid)) DESC, a.query_start NULLS LAST;
`;

interface Row {
  pid: number;
  user: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  ageSeconds: string | number | null;
  query: string | null;
  blockedBy: number[] | null;
}

/** Snapshot of "who blocks whom" — the one thing EXPLAIN can never show you. */
export async function liveLocks(
  connection: ConnectionOptions,
  capturedAt: number,
): Promise<LiveLocks> {
  const rows = await queryReadOnly<Row>(connection, SQL);
  const sessions: LiveLockSession[] = rows.map((r) => ({
    pid: r.pid,
    user: r.user,
    state: r.state,
    waitEventType: r.waitEventType,
    waitEvent: r.waitEvent,
    ageSeconds: r.ageSeconds == null ? null : Number(r.ageSeconds),
    query: r.query,
    blockedBy: r.blockedBy ?? [],
  }));
  return { sessions, blocked: sessions.filter((s) => s.blockedBy.length > 0), capturedAt };
}
