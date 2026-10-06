import { useState } from "react";
import { Bookmark, Check, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_VIEWS, type AnalyticsView } from "../../lib/analytics-settings";
import { cn } from "cn";

interface Props {
  views: AnalyticsView[];
  defaultViewId: string | null;
  /** Id de la vista cuyos filtros coinciden ahora mismo con los activos (si la hay). */
  activeViewId: string | null;
  onApply: (view: AnalyticsView) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string | null) => void;
}

/** Vistas guardadas: periodo + cuenta + grupo + categoría con nombre, y una que se abre por defecto. */
export function AnalyticsViewsMenu({ views, defaultViewId, activeViewId, onApply, onSave, onDelete, onSetDefault }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const canSave = name.trim().length > 0 && views.length < MAX_VIEWS;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave(name.trim());
    setName("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="gap-1.5 bg-card" />}>
        <Bookmark className="size-3.5" aria-hidden="true" />
        Vistas{views.length > 0 && <span className="tabular-nums text-muted-foreground">{views.length}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="border-b border-border px-3.5 py-3">
          <p className="text-sm font-medium text-foreground">Vistas guardadas</p>
          <p className="text-xs text-muted-foreground">Periodo, cuenta, grupo y categoría con un nombre. La estrella marca la que se abre al entrar.</p>
        </div>

        {views.length === 0 ? (
          <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">
            Aún no hay vistas. Ajusta los filtros y guarda la combinación para volver a ella con un clic.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-border overflow-y-auto">
            {views.map((view) => {
              const isDefault = view.id === defaultViewId;
              const isActive = view.id === activeViewId;
              return (
                <li key={view.id} className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => { onApply(view); setOpen(false); }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Check className={cn("size-3.5 shrink-0 text-primary", !isActive && "invisible")} aria-hidden="true" />
                    <span className="truncate">{view.name}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onSetDefault(isDefault ? null : view.id)}
                    aria-pressed={isDefault}
                    aria-label={isDefault ? `Quitar «${view.name}» como vista por defecto` : `Abrir «${view.name}» por defecto`}
                    title={isDefault ? "Es la vista por defecto" : "Abrir por defecto"}
                  >
                    <Star className={cn("size-4", isDefault ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDelete(view.id)} aria-label={`Eliminar la vista «${view.name}»`} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={save} className="flex items-center gap-2 border-t border-border px-3.5 py-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la vista actual"
            aria-label="Nombre para guardar la vista actual"
            maxLength={40}
            className="h-8"
            disabled={views.length >= MAX_VIEWS}
          />
          <Button type="submit" size="sm" disabled={!canSave}>Guardar</Button>
        </form>
        {views.length >= MAX_VIEWS && (
          <p className="px-3.5 pb-3 text-xs text-muted-foreground">Máximo {MAX_VIEWS} vistas: elimina alguna para guardar otra.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
