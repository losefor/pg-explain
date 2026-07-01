/**
 * Plain-English descriptions of PostgreSQL plan node types, shown as a tooltip on the node type.
 * Ported (HTML stripped, a few types added) from pev2's NODE_DESCRIPTIONS
 * (Dalibo, PostgreSQL license) — src/services/help-service.ts.
 */
const NODE_DESCRIPTIONS: Record<string, string> = {
  LIMIT: "Returns a specified number of rows from a record set.",
  SORT: "Sorts a record set based on the specified sort key.",
  INCREMENTALSORT: "Sorts a record set already partially sorted on a prefix of the sort key.",
  "NESTED LOOP":
    "Joins two record sets by looping through every record in the first set and finding matches in the second.",
  "MERGE JOIN": "Joins two record sets by first sorting them on the join key.",
  HASH: "Builds a hash table from the input records. Used by Hash Join.",
  "HASH JOIN": "Joins two record sets by hashing one of them.",
  AGGREGATE: "Groups records based on a GROUP BY or aggregate function (like sum()).",
  HASHAGGREGATE: "Groups records via a hash on the grouping key, then applies aggregates.",
  GROUPAGGREGATE: "Groups already-sorted records and applies aggregates.",
  GROUP: "Groups a sorted record set on the grouping key.",
  "SEQ SCAN":
    "Reads a table sequentially, row by row. A single read pass over the whole table.",
  "PARALLEL SEQ SCAN": "A sequential scan split across parallel workers.",
  "INDEX SCAN":
    "Finds records via an index, then reads the matching rows from the table (two read steps).",
  "INDEX ONLY SCAN":
    "Answers the query from the index alone, without reading the table (needs a current visibility map).",
  "BITMAP HEAP SCAN": "Reads the table pages identified by a Bitmap Index Scan.",
  "BITMAP INDEX SCAN": "Builds a bitmap of matching pages from an index; feeds a Bitmap Heap Scan.",
  "CTE SCAN": "Scans the materialized results of a WITH (CTE) query.",
  "SUBQUERY SCAN": "Scans the output of a sub-query.",
  "FUNCTION SCAN": "Scans the rows returned by a set-returning function.",
  "VALUES SCAN": "Scans an inline VALUES list.",
  MEMOIZE:
    "Caches results of the inner side of a nested loop, skipping re-execution for repeated parameters.",
  MATERIALIZE: "Stores the child's output so it can be re-read without re-executing the child.",
  UNIQUE: "Removes adjacent duplicate rows from a sorted input.",
  WINDOWAGG: "Computes window functions over the input rows.",
  APPEND: "Concatenates the outputs of several child plans (e.g. UNION ALL, partitions).",
  "MERGE APPEND": "Merges the outputs of several sorted child plans, preserving order.",
  GATHER: "Collects rows from parallel workers, in no particular order.",
  "GATHER MERGE": "Collects rows from parallel workers, preserving their sort order.",
  "MODIFYTABLE": "Applies INSERT / UPDATE / DELETE / MERGE changes to a table.",
  RESULT: "Emits a computed result, often a single row or a constant.",
};

export function describeNode(nodeType: string): string | undefined {
  return NODE_DESCRIPTIONS[nodeType.toUpperCase()];
}
