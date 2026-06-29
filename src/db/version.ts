/** Map a server_version_num (e.g. 160006) to the EXPLAIN options it supports. */
export interface ServerCapabilities {
  versionNum: number;
  major: number;
  /** SUMMARY — PG 10+ */
  summary: boolean;
  /** SETTINGS — PG 12+ */
  settings: boolean;
  /** WAL — PG 13+ (requires ANALYZE) */
  wal: boolean;
  /** GENERIC_PLAN — PG 16+ (mutually exclusive with ANALYZE) */
  genericPlan: boolean;
  /** SERIALIZE — PG 17+ (requires ANALYZE) */
  serialize: boolean;
  /** MEMORY — PG 17+ */
  memory: boolean;
}

export function capabilities(versionNum: number): ServerCapabilities {
  const major = Math.floor(versionNum / 10000);
  return {
    versionNum,
    major,
    summary: major >= 10,
    settings: major >= 12,
    wal: major >= 13,
    genericPlan: major >= 16,
    serialize: major >= 17,
    memory: major >= 17,
  };
}

/** "16.6" style label from a version number, for messages. */
export function versionLabel(versionNum: number): string {
  const major = Math.floor(versionNum / 10000);
  const minor = versionNum % 100;
  return `${major}.${minor}`;
}
