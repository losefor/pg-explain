import { type ConnectionOptions, queryReadOnly } from "../db/client.ts";

export interface RelationStat {
  relation: string;
  estRows: number | null;
  totalBytes: number | null;
  tableBytes: number | null;
  indexes: string[];
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

const SQL = `
SELECT c.relname                                    AS relation,
       c.reltuples::bigint                          AS "estRows",
       pg_total_relation_size(c.oid)                AS "totalBytes",
       pg_relation_size(c.oid)                      AS "tableBytes",
       (SELECT array_agg(ir.relname::text ORDER BY ir.relname)
          FROM pg_index i JOIN pg_class ir ON ir.oid = i.indexrelid
         WHERE i.indrelid = c.oid)                  AS indexes,
       s.last_vacuum                                AS "lastVacuum",
       s.last_autovacuum                            AS "lastAutovacuum",
       s.last_analyze                               AS "lastAnalyze",
       s.last_autoanalyze                           AS "lastAutoanalyze"
FROM pg_class c
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p') AND c.relname = ANY($1);
`;

interface Row {
  relation: string;
  estRows: string | number | null;
  totalBytes: string | number | null;
  tableBytes: string | number | null;
  indexes: string[] | null;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
}

const toNum = (v: string | number | null): number | null => (v == null ? null : Number(v));

/** Look up size/index/vacuum stats for the given relations to contextualize findings. */
export async function relationStats(
  connection: ConnectionOptions,
  relations: string[],
): Promise<RelationStat[]> {
  const names = [...new Set(relations.filter(Boolean))];
  if (names.length === 0) return [];
  const rows = await queryReadOnly<Row>(connection, SQL, [names]);
  return rows.map((r) => ({
    relation: r.relation,
    estRows: toNum(r.estRows),
    totalBytes: toNum(r.totalBytes),
    tableBytes: toNum(r.tableBytes),
    indexes: r.indexes ?? [],
    lastVacuum: r.lastVacuum,
    lastAutovacuum: r.lastAutovacuum,
    lastAnalyze: r.lastAnalyze,
    lastAutoanalyze: r.lastAutoanalyze,
  }));
}
