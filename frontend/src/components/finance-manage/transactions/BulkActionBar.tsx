import { useState } from "react";
import { CheckCircle2, Circle, Sparkles, Tag, Trash2, X } from "lucide-react";
import type { CategoryGroup } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CategorySelect } from "./shared";

interface Props {
  count: number;
  groups: CategoryGroup[];
  busy: boolean;
  /** Beneficiario que comparten todos los seleccionados (si es uno solo): permite recordarlo como regla. */
  commonPayee: string | null;
  /** Categoriza con las reglas y el historial de cada beneficiario. */
  onSuggest: () => void;
  onCategorize: (categoryId: number | null, rememberPayee: boolean) => void;
  onSetCleared: (cleared: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Barra flotante con las acciones sobre los movimientos seleccionados. */
export function BulkActionBar({ count, groups, busy, commonPayee, onSuggest, onCategorize, onSetCleared, onDelete, onClear }: Props) {
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [remember, setRemember] = useState(false);
  // Quitar la categoría a N movimientos es destructivo: antes era la acción
  // principal del diálogo en su estado inicial (selector vacío), a un clic.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const reset = () => {
    setCategoryOpen(false);
    setCategoryId("");
    setRemember(false);
    setConfirmRemove(false);
  };

  const apply = () => {
    if (categoryId === "") return;
    onCategorize(categoryId, remember);
    reset();
  };

  const removeCategory = () => {
    onCategorize(null, false);
    reset();
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Acciones sobre la selección"
        className="fixed inset-x-3 bottom-[calc(var(--mobile-nav-h,0px)+1rem)] z-30 mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
      >
        <span className="px-1 text-sm font-medium whitespace-nowrap text-foreground tabular-nums" aria-live="polite">
          {count}
          <span className="sr-only sm:not-sr-only"> {count === 1 ? "seleccionada" : "seleccionadas"}</span>
        </span>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={onSuggest} className="gap-1.5" aria-label="Sugerir categorías" title="Categoriza con tus reglas y con lo que ya has hecho con cada beneficiario">
          <Sparkles className="size-4" /> <span className="hidden sm:inline">Sugerir</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCategoryOpen(true)} className="gap-1.5" aria-label="Categorizar" title="Categorizar">
          <Tag className="size-4" /> <span className="hidden sm:inline">Categorizar</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSetCleared(true)} className="gap-1.5" aria-label="Marcar como liquidadas" title="Marcar como liquidadas">
          <CheckCircle2 className="size-4" /> <span className="hidden sm:inline">Liquidar</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSetCleared(false)} className="gap-1.5" aria-label="Marcar como pendientes" title="Marcar como pendientes">
          <Circle className="size-4" /> <span className="hidden sm:inline">Pendiente</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete} className="gap-1.5 text-destructive hover:text-destructive" aria-label="Eliminar" title="Eliminar">
          <Trash2 className="size-4" /> <span className="hidden sm:inline">Eliminar</span>
        </Button>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Quitar la selección" title="Quitar la selección">
          <X className="size-4" />
        </Button>
      </div>

      <Dialog open={categoryOpen} onOpenChange={(o) => { if (!o) reset(); }}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
            <DialogTitle>Categorizar {count} {count === 1 ? "movimiento" : "movimientos"}</DialogTitle>
            <DialogDescription>
              Los traspasos de la selección se omiten: no tienen categoría.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 px-5 py-5">
            <Label htmlFor="bulk-category">Categoría</Label>
            <CategorySelect id="bulk-category" value={categoryId} onChange={(v) => { setCategoryId(v); setConfirmRemove(false); }} groups={groups} noneLabel="Elige una categoría" />
            {commonPayee && categoryId !== "" && (
              <div className="flex items-start gap-2.5 pt-3">
                <Checkbox id="bulk-remember" checked={remember} onCheckedChange={(c) => setRemember(c === true)} className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor="bulk-remember" className="cursor-pointer">Recordarlo para «{commonPayee}»</Label>
                  <p className="text-xs text-muted-foreground">Crea una regla: los próximos movimientos de ese beneficiario se categorizarán solos.</p>
                </div>
              </div>
            )}
          </div>
          {confirmRemove && (
            <p role="alert" className="mx-5 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Se quitará la categoría a {count} {count === 1 ? "movimiento" : "movimientos"}. Dejarán de contar en el presupuesto de su categoría.
            </p>
          )}
          <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3 sm:justify-between">
            {confirmRemove ? (
              <Button type="button" variant="destructive" onClick={removeCategory} disabled={busy}>
                Sí, quitar la categoría
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy} className="text-muted-foreground">
                Dejar sin categoría
              </Button>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={reset}>Cancelar</Button>
              <Button type="button" onClick={apply} disabled={busy || categoryId === ""}>
                Aplicar categoría
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
