import { Repeat } from "lucide-react";
import type { SubscriptionSuggestion } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { SectionCard } from "../../app";
import { Button } from "@/components/ui/button";
import { formatDateLong } from "./shared";

interface Props {
  suggestions: SubscriptionSuggestion[];
  onSchedule: (s: SubscriptionSuggestion) => void;
}

/** Gastos que se repiten cada mes y aún no están programados: se proponen, nunca se crean solos. */
export function SubscriptionSuggestions({ suggestions, onSchedule }: Props) {
  if (suggestions.length === 0) return null;
  const monthly = suggestions.reduce((sum, s) => sum + s.amount, 0);
  return (
    <SectionCard
      className="mt-6"
      title="Posibles suscripciones"
      description={`Cargos que se repiten cada mes y aún no tienes programados · ${formatCurrency(monthly)} al mes`}
      icon={Repeat}
      flush
    >
      <ul className="divide-y divide-border">
        {suggestions.map((s) => (
          <li key={s.payee} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{s.payee}</p>
              <p className="text-xs text-muted-foreground">
                {s.occurrences} cargos · último {formatDateLong(s.lastDate)} · próximo hacia el {formatDateLong(s.nextDate)}
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(s.amount)}/mes</span>
            <Button variant="outline" size="sm" onClick={() => onSchedule(s)}>Programar</Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
