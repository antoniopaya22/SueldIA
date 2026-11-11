import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonthKey, monthLabel, shiftMonth } from "../../lib/dates";
import { Button } from "@/components/ui/button";

/** Mes anterior / siguiente y «Hoy» cuando no se está en el mes en curso. */
export function MonthSwitcher({ month, onChange, max }: { month: string; onChange: (month: string) => void; /** Último mes permitido ("YYYY-MM"). */ max?: string }) {
  const thisMonth = currentMonthKey();
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Mes anterior">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 px-1 text-center text-sm font-medium text-foreground tabular-nums" aria-live="polite">
        {monthLabel(month)}
      </span>
      <Button variant="outline" size="icon-sm" onClick={() => onChange(shiftMonth(month, 1))} disabled={!!max && month >= max} aria-label="Mes siguiente">
        <ChevronRight className="size-4" />
      </Button>
      {month !== thisMonth && (
        <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>Hoy</Button>
      )}
    </div>
  );
}
