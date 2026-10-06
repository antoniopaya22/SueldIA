import { useState } from "react";
import { CheckCircle2, Circle, Tag, Trash2, X } from "lucide-react";
import type { CategoryGroup } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CategorySelect } from "./shared";

interface Props {
  count: number;
  groups: CategoryGroup[];
  busy: boolean;
  onCategorize: (categoryId: number | null) => void;
  onSetCleared: (cleared: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Barra flotante con las acciones sobre los movimientos seleccionados. */
export function BulkActionBar({ count, groups, busy, onCategorize, onSetCleared, onDelete, onClear }: Props) {
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | "">("");

  const apply = () => {
    onCategorize(categoryId === "" ? null : categoryId);
    setCategoryOpen(false);
    setCategoryId("");
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Acciones sobre la selección"
        className="fixed inset-x-3 bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-1.5 overflow-x-auto rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
      >
        <span className="px-1 text-sm font-medium whitespace-nowrap text-foreground tabular-nums" aria-live="polite">
          {count}
          <span className="sr-only sm:not-sr-only"> {count === 1 ? "seleccionada" : "seleccionadas"}</span>
        </span>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
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

      <Dialog open={categoryOpen} onOpenChange={(o) => { if (!o) setCategoryOpen(false); }}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
            <DialogTitle>Categorizar {count} {count === 1 ? "movimiento" : "movimientos"}</DialogTitle>
            <DialogDescription>
              Los traspasos de la selección se omiten: no tienen categoría.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 px-5 py-5">
            <Label htmlFor="bulk-category">Categoría</Label>
            <CategorySelect id="bulk-category" value={categoryId} onChange={setCategoryId} groups={groups} noneLabel="Elige una categoría o déjalo vacío para quitarla" />
          </div>
          <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={() => setCategoryOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={apply} disabled={busy}>
              {categoryId === "" ? "Quitar categoría" : "Aplicar categoría"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
