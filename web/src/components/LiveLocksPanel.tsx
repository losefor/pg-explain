import { Button } from "@/components/ui/button";
import type { LiveLocks } from "../lib/api.ts";

export function LiveLocksPanel({ live, onClose }: { live: LiveLocks; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Live locks</h2>
        <span className="text-xs text-muted-foreground">
          {live.sessions.length} client sessions · {live.blocked.length} blocked
        </span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      {live.blocked.length === 0 ? (
        <div className="text-sm text-muted-foreground rounded-lg border p-4" style={{ background: "var(--card)" }}>
          No lock contention right now — nothing is waiting on another session.
        </div>
      ) : (
        live.blocked.map((s) => (
          <div key={s.pid} className="rounded-lg border-l-4 p-3" style={{ borderColor: "var(--sev-warn)", background: "var(--card)" }}>
            <div className="text-sm">
              <b>pid {s.pid}</b> ({s.user ?? "?"}) is <b>blocked by</b> pid {s.blockedBy.join(", ")}
              {s.ageSeconds != null && <span className="text-muted-foreground"> · waiting {s.ageSeconds.toFixed(0)}s</span>}
              {s.waitEvent && <span className="text-muted-foreground"> · {s.waitEvent}</span>}
            </div>
            {s.query && <pre className="text-xs bg-secondary rounded p-2 mt-2 overflow-x-auto">{s.query}</pre>}
            <p className="text-xs text-muted-foreground mt-2">
              Inspect the blocker; if needed, cancel it with <code>SELECT pg_cancel_backend({s.blockedBy[0]});</code> or terminate with <code>pg_terminate_backend(…)</code>.
            </p>
          </div>
        ))
      )}
    </div>
  );
}
