/**
 * Process exit codes. Documented in README and `pg-explain --help` so scripts and
 * CI can branch on the *kind* of failure without parsing text.
 */
export enum ExitCode {
  /** Report produced. Findings alone do not change this unless --strict/--fail-on. */
  Success = 0,
  /** CI gate tripped: findings present AND --strict / --fail-on threshold met. */
  CiGate = 1,
  /** Usage error: bad flags/args, refused non-SELECT, unsupported option. */
  Usage = 2,
  /** Input error: no/empty stdin and no --file, unreadable file. */
  Input = 3,
  /** Parse/validation error: not valid EXPLAIN JSON or wrong shape. */
  Parse = 4,
  /** Database error: connect/auth/permission/timeout/cancel. */
  Database = 5,
  /** pg-explain itself hit an unexpected error. */
  Internal = 70,
  /** Interrupted by SIGINT. (128 + signal number.) */
  Sigint = 130,
}
