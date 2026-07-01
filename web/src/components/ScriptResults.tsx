import { ChevronRight } from "lucide-react";
import type { ScriptAnalysis } from "../lib/api.ts";
import { Results } from "./Results.tsx";

export function ScriptResults({ script }: { script: ScriptAnalysis }) {
  const analyzed = script.units.filter((u) => u.status === "analyzed").length;
  const skipped = script.units.length - analyzed;
  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3 border-l-4" style={{ borderColor: "var(--sev-info)", background: "var(--card)" }}>
        <div className="font-medium">Cost-only analysis — nothing was executed</div>
        <div className="text-xs text-muted-foreground mt-1">
          Extracted {script.units.length} statement(s) · {analyzed} analyzed, {skipped} skipped. No rows
          touched, no sequences advanced, no triggers fired{script.serverMajor ? ` · PG ${script.serverMajor}` : ""}.
        </div>
      </div>
      {script.units.map((u, i) => (
        <div key={`${u.label}-${i}`} className="space-y-2">
          <div className="flex items-center gap-1 font-medium text-sm">
            <ChevronRight className="size-4 shrink-0" /> {u.label}
            {u.loopNote && <span className="text-muted-foreground"> ({u.loopNote})</span>}
          </div>
          {u.status === "analyzed" && u.report ? (
            <Results report={u.report} stats={[]} />
          ) : (
            <div className="rounded-lg border p-3 text-sm" style={{ background: "var(--card)" }}>
              <span style={{ color: u.status === "error" ? "var(--sev-warn)" : "var(--muted-foreground)" }}>
                {u.status === "error" ? "Could not analyze" : "Skipped"}:
              </span>{" "}
              {u.reason}
              {u.errorCode && <span className="text-xs text-muted-foreground"> [{u.errorCode}]</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
