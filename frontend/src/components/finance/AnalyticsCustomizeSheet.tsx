import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Segmented } from "../app";
import { PANEL_REGISTRY, moveEntry, type LayoutEntry, type PanelKey, type PanelSpan } from "../../lib/analytics-settings";
import { cn } from "cn";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout: LayoutEntry[];
  onChange: (layout: LayoutEntry[]) => void;
  onReset: () => void;
}

/** Panel lateral para elegir qué gráficos se ven, en qué orden y con qué ancho. */
export function AnalyticsCustomizeSheet({ open, onOpenChange, layout, onChange, onReset }: Props) {
  const visibleCount = layout.filter((e) => e.visible).length;

  const patch = (key: PanelKey, changes: Partial<LayoutEntry>) =>
    onChange(layout.map((e) => (e.key === key ? { ...e, ...changes } : e)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
          <SheetTitle>Personalizar la analítica</SheetTitle>
          <SheetDescription>
            Elige qué gráficos ver, en qué orden y de qué ancho. Se guarda en tu cuenta y te sigue a otros dispositivos.
          </SheetDescription>
        </SheetHeader>

        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {layout.map((entry, i) => {
            const info = PANEL_REGISTRY[entry.key];
            return (
              <li key={entry.key} className={cn("flex items-start gap-3 px-5 py-3.5", !entry.visible && "bg-muted/30")}>
                <Switch
                  checked={entry.visible}
                  onCheckedChange={(visible) => patch(entry.key, { visible })}
                  aria-label={`${entry.visible ? "Ocultar" : "Mostrar"} «${info.label}»`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", entry.visible ? "text-foreground" : "text-muted-foreground")}>{info.label}</p>
                  <p className="text-xs text-muted-foreground">{info.description}</p>
                  <Segmented<PanelSpan>
                    aria-label={`Ancho de «${info.label}»`}
                    value={entry.span}
                    onChange={(span) => patch(entry.key, { span })}
                    options={[{ value: "half", label: "Mitad" }, { value: "full", label: "Ancho" }]}
                    className="mt-2"
                  />
                </div>
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onChange(moveEntry(layout, entry.key, -1))}
                    disabled={i === 0}
                    aria-label={`Subir «${info.label}»`}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onChange(moveEntry(layout, entry.key, 1))}
                    disabled={i === layout.length - 1}
                    aria-label={`Bajar «${info.label}»`}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <SheetFooter className="flex-row items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {visibleCount} de {layout.length} visibles
          </span>
          <Button variant="outline" size="sm" onClick={onReset} className="gap-1.5">
            <RotateCcw className="size-3.5" aria-hidden="true" /> Restablecer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
