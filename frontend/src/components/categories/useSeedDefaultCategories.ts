import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { seedDefaultCategories } from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";

/** Crea las categorías de partida en español (idempotente: no duplica lo que ya existe). */
export function useSeedDefaultCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: seedDefaultCategories,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      invalidateFinance(queryClient);
      toast.success(
        res.categories === 0
          ? "Ya tenías todas las categorías de partida"
          : `Creadas ${res.categories} categorías en ${res.groups} ${res.groups === 1 ? "grupo" : "grupos"}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
