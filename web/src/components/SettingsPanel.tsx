import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useState } from "react";
import { api, type ApiError, type Settings } from "../lib/api.ts";

export function SettingsPanel({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [thresholds, setThresholds] = useState<Record<string, number>>(settings.thresholds);

  const save = async () => {
    try {
      await api.saveSettings({ thresholds, rules: settings.rules });
      toast("Settings saved — applied to new analyses.");
    } catch (e) {
      toast(`Could not save settings: ${(e as ApiError).title}`, "error");
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Settings</h2>
        <span className="text-xs text-muted-foreground">Advisor thresholds — saved to your data dir and applied to new analyses.</span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={onClose}>Close</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(thresholds).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-muted-foreground">{key}</span>
            <Input
              type="number"
              value={value}
              onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
              className="w-28"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save}>Save</Button>
        <span className="text-xs text-muted-foreground">Per-rule enable/severity overrides are editable in the config file.</span>
      </div>
    </div>
  );
}
