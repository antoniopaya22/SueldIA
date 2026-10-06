import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wand2, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  applyCategorySuggestions, createCategoryRule, deleteCategoryRule, getCategoryRules, type CategoryGroup,
} from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";
import { SectionCard } from "../app";
import { CategorySelect } from "../finance-manage/transactions/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Resultado de "aplicar a los gastos sin categoría" en una frase. */
export function describeApply(res: { updated: number; skipped: number; byRule: number; byHistory: number }): string {
  if (res.updated === 0) return "Ninguno tenía regla ni historial con el que categorizarlo.";
  const parts = [`${res.updated} ${res.updated === 1 ? "movimiento categorizado" : "movimientos categorizados"}`];
  if (res.byRule > 0 && res.byHistory > 0) parts.push(`${res.byRule} por regla y ${res.byHistory} por historial`);
  else if (res.byHistory > 0) parts.push("por historial");
  else parts.push("por regla");
  return parts.join(" · ");
}

/**
 * Reglas automáticas: "si el beneficiario contiene X, la categoría es Y". Se
 * aplican a los movimientos nuevos sin categoría; este panel también las aplica
 * a lo que ya hay.
 */
export function CategoryRulesCard({ groups }: { groups: CategoryGroup[] }) {
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ["category-rules"], queryFn: getCategoryRules });
  const [match, setMatch] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");

  const createMut = useMutation({
    mutationFn: () => createCategoryRule({ match: match.trim(), categoryId: Number(categoryId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      setMatch("");
      setCategoryId("");
      toast.success("Regla guardada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteCategoryRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      toast.success("Regla eliminada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: () => applyCategorySuggestions(),
    onSuccess: (res) => {
      invalidateFinance(queryClient);
      (res.updated > 0 ? toast.success : toast.info)(describeApply(res));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canAdd = match.trim().length >= 2 && categoryId !== "";

  return (
    <SectionCard
      className="mt-6"
      title="Reglas automáticas"
      description="Si el beneficiario contiene un texto, el movimiento nuevo sin categoría la recibe solo."
      icon={Zap}
      action={
        <Button variant="outline" size="sm" onClick={() => applyMut.mutate()} disabled={applyMut.isPending} className="gap-1.5">
          <Wand2 className="size-4" aria-hidden="true" />
          {applyMut.isPending ? "Aplicando…" : "Aplicar a mis gastos sin categoría"}
        </Button>
      }
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (canAdd) createMut.mutate(); }}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <Input
          value={match}
          onChange={(e) => setMatch(e.target.value)}
          placeholder="Si el beneficiario contiene… (ej.: mercadona)"
          aria-label="Texto que debe contener el beneficiario"
          maxLength={100}
          className="sm:flex-1"
        />
        <CategorySelect value={categoryId} onChange={setCategoryId} groups={groups} noneLabel="Elige la categoría" className="sm:w-64" />
        <Button type="submit" disabled={!canAdd || createMut.isPending} className="gap-1.5">
          <Plus className="size-4" aria-hidden="true" /> Añadir
        </Button>
      </form>

      <div className="mt-4">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
            Aún no tienes reglas. Crea una para que, por ejemplo, todo lo de «mercadona» vaya a Supermercado sin tocar nada.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">Contiene </span>
                  <span className="font-medium text-foreground">«{rule.match}»</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="text-foreground">{rule.groupName} · {rule.categoryName}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => deleteMut.mutate(rule.id)}
                  disabled={deleteMut.isPending}
                  aria-label={`Eliminar la regla «${rule.match}»`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
