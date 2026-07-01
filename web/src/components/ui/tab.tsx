import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant={active ? "default" : "secondary"} size="sm" onClick={onClick} role="tab" aria-selected={active}>
      {children}
    </Button>
  );
}
