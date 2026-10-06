import { CalendarClock, ChevronDown, Copy, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AutoAssignMode } from "../../lib/api";

interface Props {
  onRun: (mode: AutoAssignMode) => void;
  busy: boolean;
  hasTargets: boolean;
}

/** Asignar de golpe en vez de categoría por categoría. */
export function QuickAssignMenu({ onRun, busy, hasTargets }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={busy} className="gap-1.5" />}>
        <Sparkles className="size-4" aria-hidden="true" />
        Asignar rápido
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuItem onClick={() => onRun("copy-previous")} className="items-start gap-2">
          <Copy className="mt-0.5 size-4" aria-hidden="true" />
          <span>
            <span className="block font-medium">Copiar el mes anterior</span>
            <span className="block text-xs text-muted-foreground">Mismos importes que el mes pasado</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRun("average-3")} className="items-start gap-2">
          <CalendarClock className="mt-0.5 size-4" aria-hidden="true" />
          <span>
            <span className="block font-medium">Media de los últimos 3 meses</span>
            <span className="block text-xs text-muted-foreground">Lo que sueles gastar en cada categoría</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRun("targets")} disabled={!hasTargets} className="items-start gap-2">
          <Target className="mt-0.5 size-4" aria-hidden="true" />
          <span>
            <span className="block font-medium">Cumplir los objetivos</span>
            <span className="block text-xs text-muted-foreground">
              {hasTargets ? "Asigna lo que falta en cada categoría con objetivo" : "Crea algún objetivo primero"}
            </span>
          </span>
        </DropdownMenuItem>
        <p className="px-2 pt-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
          Copiar y la media solo rellenan categorías sin importe este mes: no pisan lo que ya has puesto.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
