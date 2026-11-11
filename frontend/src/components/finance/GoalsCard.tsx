import { useQuery } from "@tanstack/react-query";
import { Goal } from "lucide-react";
import { getSavingsGoals } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { CardLink, SectionCard } from "../app";
import { GoalProgressBar, goalSummary } from "./GoalProgress";

/** Resumen de los objetivos de ahorro activos (los tres más cercanos). Sin objetivos, no se pinta. */
export function GoalsCard() {
  const { data: goals = [] } = useQuery({ queryKey: ["savings-goals"], queryFn: getSavingsGoals });
  const active = goals.filter((g) => !g.archived).slice(0, 3);
  if (active.length === 0) return null;
  return (
    <SectionCard className="mt-6" title="Objetivos de ahorro" icon={Goal} action={<CardLink href="/app/goals">Ver todos</CardLink>}>
      <ul className="space-y-4">
        {active.map((g) => (
          <li key={g.id}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-foreground">{g.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(g.progress.saved)} / {formatCurrency(g.targetAmount)}</span>
            </div>
            <GoalProgressBar goal={g} />
            <p className="mt-1 text-xs text-muted-foreground">{goalSummary(g)}</p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
