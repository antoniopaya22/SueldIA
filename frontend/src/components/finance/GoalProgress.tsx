import type { SavingsGoal } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { adaptiveColor } from "@/lib/color";
import { cn } from "cn";

const monthYear = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });

/** Frase de estado de un objetivo: lo que falta y cuánto apartar al mes. */
export function goalSummary(goal: SavingsGoal): string {
  const p = goal.progress;
  switch (p.status) {
    case "done":
      return "¡Conseguido!";
    case "overdue":
      return `Te faltan ${formatCurrency(p.remaining)} y la fecha ya ha pasado`;
    case "no-date":
      return `Te faltan ${formatCurrency(p.remaining)}`;
    default:
      return `Aparta ${formatCurrency(p.monthlyNeeded)} al mes para llegar en ${monthYear(goal.targetDate!)}`;
  }
}

/** Barra de progreso accesible de un objetivo. */
export function GoalProgressBar({ goal, className }: { goal: SavingsGoal; className?: string }) {
  const pct = Math.min(100, Math.max(0, goal.progress.percent));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={`${goal.name}: ${goal.progress.percent.toLocaleString("es-ES")} %`}
    >
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, backgroundColor: adaptiveColor(goal.color, "var(--chart-1)") }} />
    </div>
  );
}
