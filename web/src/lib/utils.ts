import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { PlanNode } from "./api.ts";

/** Merge Tailwind classes safely, resolving conflicts (e.g. p-2 + p-4 → p-4). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** True when the SQL isn't a single plain SELECT — a DO block, multi-statement, or a write. */
export function isScripty(sql: string): boolean {
  const s = sql.trim();
  if (/^do\b/i.test(s)) return true;
  if (/;\s*\S/.test(s.replace(/;\s*$/, ""))) return true;
  return !/^(select|with|table|values|explain)\b/i.test(s);
}

/** Unique relation names referenced anywhere in a plan tree. */
export function collectRelations(node: PlanNode, acc = new Set<string>()): string[] {
  if (node.relationName) acc.add(node.relationName);
  for (const c of node.children) collectRelations(c, acc);
  return [...acc];
}

/** Human-readable byte size (binary units). */
export function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
