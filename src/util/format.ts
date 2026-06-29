/** Locale-aware, unit-consistent formatting shared by every renderer. */

/** Postgres default block size; buffer counters are in blocks. */
const BLOCK_BYTES = 8192;

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Times are milliseconds throughout. */
export function fmtMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const min = Math.floor(ms / 60_000);
  const sec = ((ms % 60_000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

export function fmtPct(fraction0to100: number): string {
  return `${fraction0to100.toFixed(1)}%`;
}

/** Postgres reports sort/hash space in KiB. */
export function fmtKiB(kib: number): string {
  return fmtBytes(kib * 1024);
}

/** Buffer counters are in 8 KiB blocks. */
export function fmtBlocks(blocks: number): string {
  return `${fmtInt(blocks)} blk (${fmtBytes(blocks * BLOCK_BYTES)})`;
}

export function fmtBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(1);
  return `${s} ${units[i]}`;
}

/** Round a KiB value up to the next whole MiB (work_mem recommendations). */
export function roundUpMiB(kib: number, stepMiB = 4): string {
  const mib = Math.ceil(kib / 1024 / stepMiB) * stepMiB;
  return `${Math.max(mib, stepMiB)}MB`;
}

export interface TreeGlyphs {
  branch: string;
  last: string;
  vert: string;
  space: string;
}

export const UNICODE_TREE: TreeGlyphs = { branch: "├─ ", last: "└─ ", vert: "│  ", space: "   " };
export const ASCII_TREE: TreeGlyphs = { branch: "+- ", last: "`- ", vert: "|  ", space: "   " };
