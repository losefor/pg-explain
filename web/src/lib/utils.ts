/** Minimal class combiner (shadcn uses clsx+tailwind-merge; this keeps deps lean for now). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
