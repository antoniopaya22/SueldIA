import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteCategory, deleteCategoryGroup, getCategoryGroupUsage, getCategoryUsage,
  type CategoryGroup, type CategoryUsage,
} from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";
import { CategorySelect } from "../finance-manage/transactions/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";

export interface DeleteCategoryTarget {
  type: "group" | "category";
  id: number;
  name: string;
}

function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;
}

/** Frases con lo que se vería afectado; vacío si no hay nada. */
function usageLines(u: CategoryUsage, type: DeleteCategoryTarget["type"]): string[] {
  const lines: string[] = [];
  if (type === "group" && u.categories) lines.push(plural(u.categories, "categoría", "categorías"));
  if (u.transactions) lines.push(plural(u.transactions, "movimiento", "movimientos"));
  if (u.recurring) lines.push(plural(u.recurring, "programación recurrente", "programaciones recurrentes"));
  if (u.budgetMonths) lines.push(`presupuesto asignado en ${plural(u.budgetMonths, "mes", "meses")}`);
  if (u.rules) lines.push(plural(u.rules, "regla de categorización", "reglas de categorización"));
  if (u.targets) lines.push(plural(u.targets, "objetivo", "objetivos"));
  return lines;
}

/**
 * Confirmación de borrado de una categoría o grupo que dice qué se pierde y,
 * si hay datos, obliga a decidir: moverlos a otra categoría (por defecto) o
 * dejar los movimientos sin categoría. Antes el diálogo solo decía "no se
 * puede deshacer" y el borrado descuadraba el presupuesto en silencio.
 */
export function DeleteCategoryDialog({
  target, groups, onClose,
}: {
  target: DeleteCategoryTarget | null;
  groups: CategoryGroup[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"move" | "drop">("move");
  const [destination, setDestination] = useState<number | "">("");

  const { data: usage, isLoading, error } = useQuery({
    queryKey: ["category-usage", target?.type, target?.id],
    queryFn: () => (target!.type === "group" ? getCategoryGroupUsage(target!.id) : getCategoryUsage(target!.id)),
    enabled: !!target,
    staleTime: 0,
  });

  // Destinos posibles: todo menos lo que se borra.
  const destinationGroups = useMemo(() => {
    if (!target) return groups;
    if (target.type === "group") return groups.filter((g) => g.id !== target.id);
    return groups.map((g) => ({ ...g, categories: g.categories.filter((c) => c.id !== target.id) }));
  }, [groups, target]);

  const close = () => {
    setMode("move");
    setDestination("");
    onClose();
  };

  const deleteMut = useMutation({
    mutationFn: () => {
      const reassignTo = mode === "move" && destination !== "" ? destination : undefined;
      return target!.type === "group" ? deleteCategoryGroup(target!.id, reassignTo) : deleteCategory(target!.id, reassignTo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      invalidateFinance(queryClient);
      toast.success(target!.type === "group" ? "Grupo eliminado" : "Categoría eliminada");
      close();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });

  const lines = usage ? usageLines(usage, target?.type ?? "category") : [];
  const hasData = !!usage && (usage.transactions + usage.recurring + usage.budgetMonths + usage.rules) > 0;
  const noDestinations = destinationGroups.every((g) => g.categories.length === 0);
  const canDelete = !!usage && (!hasData || mode === "drop" || destination !== "");
  const noun = target?.type === "group" ? "el grupo" : "la categoría";

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle>Eliminar {noun} «{target?.name}»</DialogTitle>
          <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-5 text-sm">
          {isLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Comprobando qué se vería afectado…</p>
          ) : error ? (
            <p role="alert" className="text-destructive">No se pudo comprobar qué se vería afectado. Cierra e inténtalo de nuevo.</p>
          ) : !hasData ? (
            <p className="text-muted-foreground">
              {lines.length > 0 ? `Se eliminará ${noun} junto con: ${lines.join(", ")}.` : `No tiene movimientos ni presupuesto: se puede eliminar sin perder nada.`}
            </p>
          ) : (
            <>
              <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">Tiene datos asociados:</p>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {lines.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="mb-1 font-medium text-foreground">¿Qué hacemos con ellos?</legend>
                <ChoiceRow
                  checked={mode === "move"}
                  onSelect={() => setMode("move")}
                  disabled={noDestinations}
                  title="Moverlos a otra categoría"
                  description="Movimientos, recurrentes, reglas y lo asignado en el presupuesto pasan a la categoría que elijas."
                />
                {mode === "move" && !noDestinations && (
                  <div className="space-y-1.5 pl-7">
                    <Label htmlFor="delete-category-destination" className="sr-only">Categoría de destino</Label>
                    <CategorySelect
                      id="delete-category-destination"
                      value={destination}
                      onChange={setDestination}
                      groups={destinationGroups}
                      noneLabel="Elige la categoría de destino"
                    />
                  </div>
                )}
                <ChoiceRow
                  checked={mode === "drop"}
                  onSelect={() => setMode("drop")}
                  title="Dejar los movimientos sin categoría"
                  description="Se borran el presupuesto, los objetivos y las reglas. El gasto deja de contar en ninguna categoría."
                />
              </fieldset>
            </>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={() => deleteMut.mutate()} disabled={!canDelete || deleteMut.isPending}>
            {deleteMut.isPending ? "Eliminando…" : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceRow({
  checked, onSelect, title, description, disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn(
      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
      checked ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50",
      disabled && "cursor-not-allowed opacity-50",
    )}>
      <input
        type="radio"
        name="delete-category-mode"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-0.5 size-4 accent-[var(--primary)]"
      />
      <span>
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
