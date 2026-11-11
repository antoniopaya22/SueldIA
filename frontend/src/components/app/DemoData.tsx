import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { getDemoStatus, loadDemoData, removeDemoData } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Carga o quita los datos de ejemplo, refrescando toda la app. */
export function useDemoData() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["demo-data"], queryFn: getDemoStatus, staleTime: 5 * 60_000 });
  const refreshAll = () => void queryClient.invalidateQueries();
  const load = useMutation({
    mutationFn: loadDemoData,
    onSuccess: () => { refreshAll(); toast.success("Datos de ejemplo cargados: un año de nóminas y movimientos de «Lucía»"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: removeDemoData,
    onSuccess: () => { refreshAll(); toast.success("Datos de ejemplo quitados"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return { loaded: status.data?.loaded === true, load, remove };
}

/** Botón «Explorar con datos de ejemplo» (para estados vacíos y primeros pasos). */
export function LoadDemoButton({ variant = "outline" }: { variant?: "outline" | "ghost" | "default" }) {
  const { loaded, load } = useDemoData();
  if (loaded) return null;
  return (
    <Button variant={variant} size="sm" onClick={() => load.mutate()} disabled={load.isPending} className="gap-1.5">
      {load.isPending ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
      Explorar con datos de ejemplo
    </Button>
  );
}

/** Aviso fijo mientras haya datos de ejemplo, con el botón para quitarlos. */
export function DemoBanner() {
  const { loaded, remove } = useDemoData();
  if (!loaded) return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-2.5 text-sm">
      <FlaskConical className="size-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-foreground">
        Estás viendo <strong className="font-medium">datos de ejemplo</strong> (el perfil «Lucía», la «Cuenta de ejemplo» y el grupo «Ejemplo»). Quítalos cuando quieras: lo tuyo no se toca.
      </p>
      <Button variant="outline" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending} className="gap-1.5">
        {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        Quitar datos de ejemplo
      </Button>
    </div>
  );
}
