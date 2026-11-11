import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { previewReparse, reparsePayslips, type ReparseSnapshot } from "@/lib/api";
import { formatCurrency, plural } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPeriod } from "./shared";
import { cn } from "cn";

function Diff({ before, after, format }: { before: string; after: string; format?: "money" }) {
  if (before === after) return <span className="text-muted-foreground">{before}</span>;
  return (
    <span className={cn("tabular-nums", format === "money" && "whitespace-nowrap")}>
      <span className="text-muted-foreground line-through decoration-muted-foreground/60">{before}</span>{" "}
      <span className="font-medium text-foreground">→ {after}</span>
    </span>
  );
}

const money = (v: number | null) => (v == null ? "—" : formatCurrency(v));
const period = (s: ReparseSnapshot) => formatPeriod(s.periodMonth, s.periodYear);

/**
 * Reprocesar con el analizador actual, enseñando antes qué cambiaría nómina
 * por nómina. Sin `ids`: todas las del usuario. Las corregidas a mano no se tocan.
 */
export function ReparsePreviewDialog({ open, ids, onClose }: { open: boolean; ids?: number[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["reparse-preview", ids ?? "all"],
    queryFn: () => previewReparse(ids),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
  });
  const applyMut = useMutation({
    mutationFn: () => reparsePayslips(ids),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["payslips"] });
      queryClient.invalidateQueries({ queryKey: ["payslip"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`${plural(r.reparsed, "nómina reprocesada", "nóminas reprocesadas")}${r.errors ? ` · ${plural(r.errors, "error", "errores")}` : ""}`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changes = data?.changes ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !applyMut.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reprocesar {ids ? plural(ids.length, "nómina", "nóminas") : "todas las nóminas"}</DialogTitle>
          <DialogDescription>
            Vuelve a leer el texto guardado con el analizador actual. Antes de aplicar nada, esto es lo que cambiaría.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Comparando…</div>
        ) : error ? (
          <p className="py-6 text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {changes.length === 0 ? "Ninguna nómina cambiaría." : `${plural(changes.length, "nómina cambiaría", "nóminas cambiarían")}.`}
              {data && data.unchanged > 0 && ` ${plural(data.unchanged, "se queda", "se quedan")} igual.`}
              {data && data.skippedEdited > 0 && ` ${plural(data.skippedEdited, "corregida a mano no se toca", "corregidas a mano no se tocan")}.`}
            </p>
            {changes.length > 0 && (
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Nómina</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Periodo</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Bruto</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Neto</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Conceptos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {changes.map((c) => (
                      <tr key={c.id}>
                        <th scope="row" className="max-w-48 truncate px-3 py-2 text-left font-normal" title={c.fileName}>{c.fileName}</th>
                        <td className="px-3 py-2"><Diff before={period(c.before)} after={period(c.after)} /></td>
                        <td className="px-3 py-2 text-right"><Diff before={money(c.before.grossSalary)} after={money(c.after.grossSalary)} format="money" /></td>
                        <td className="px-3 py-2 text-right"><Diff before={money(c.before.netSalary)} after={money(c.after.netSalary)} format="money" /></td>
                        <td className="px-3 py-2 text-right"><Diff before={String(c.before.concepts)} after={String(c.after.concepts)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applyMut.isPending}>Cancelar</Button>
          <Button onClick={() => applyMut.mutate()} disabled={isLoading || !!error || changes.length === 0 || applyMut.isPending} className="gap-1.5">
            {applyMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Aplicar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
