import { useEffect, useState } from "react";

export interface ToastItem {
  id: number;
  message: string;
  kind: "success" | "error";
}

// ponytail: module-level dispatch instead of context — one Toaster per app, no provider tree.
let dispatch: ((t: Omit<ToastItem, "id">) => void) | null = null;
let seq = 0;

/** Show a transient notification. Safe to call from anywhere (no-op before Toaster mounts). */
export function toast(message: string, kind: ToastItem["kind"] = "success") {
  dispatch?.({ message, kind });
}

const KIND_COLOR: Record<ToastItem["kind"], string> = {
  success: "var(--sev-info)",
  error: "var(--sev-error)",
};

/** Fixed bottom-right toast stack. Mount once, at the app root. */
export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    dispatch = (t) => {
      const id = ++seq;
      setToasts((ts) => [...ts, { ...t, id }]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
    };
    return () => {
      dispatch = null;
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border-l-4 border bg-card px-4 py-2.5 text-sm shadow-lg max-w-sm"
          style={{ borderLeftColor: KIND_COLOR[t.kind] }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
