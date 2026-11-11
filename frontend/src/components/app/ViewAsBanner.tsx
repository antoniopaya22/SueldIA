import { Eye } from "lucide-react";
import { getViewAs, switchViewAs } from "@/lib/view-as";
import { useHydrated } from "@/hooks/use-hydrated";
import { Button } from "@/components/ui/button";

/** Aviso fijo mientras se ven los datos de otra persona (solo lectura). */
export function ViewAsBanner() {
  // localStorage solo existe en el navegador: tras hidratar, para no desajustar el HTML.
  const hydrated = useHydrated();
  const viewing = hydrated ? getViewAs() : null;
  if (!viewing) return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Estás viendo los datos de <strong>{viewing.name}</strong>. Solo lectura: puedes mirar todo, pero no cambiar nada.
      </p>
      <Button size="sm" variant="outline" className="border-sky-500/40 bg-transparent" onClick={() => switchViewAs(null)}>
        Volver a los míos
      </Button>
    </div>
  );
}
