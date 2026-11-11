import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Scale } from "lucide-react";
import { toast } from "sonner";
import { getAccountClearedBalance, reconcileAccount, type Account } from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";
import { formatCurrency, plural } from "../../lib/format";
import { transactionsHref } from "../../lib/transaction-filters";
import { DecimalInput } from "../app";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";

/**
 * Conciliar una cuenta: el usuario escribe el saldo que le dice el banco y se
 * compara con el saldo liquidado de SueldIA. Si cuadra, se concilia; si no,
 * puede revisar los pendientes o crear un ajuste por la diferencia.
 */
export function ReconcileDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["account-cleared", account?.id],
    queryFn: () => getAccountClearedBalance(account!.id),
    enabled: !!account,
    staleTime: 0,
  });
  const cleared = data?.clearedBalance;
  const valid = statement != null && Number.isFinite(statement);
  const difference = valid && cleared != null ? Math.round((statement - cleared) * 100) / 100 : null;

  const close = () => {
    setStatement(null);
    onClose();
  };

  const mutation = useMutation({
    mutationFn: (createAdjustment: boolean) => reconcileAccount(account!.id, statement!, createAdjustment),
    onSuccess: (res) => {
      invalidateFinance(queryClient);
      toast.success(
        res.adjustmentId
          ? `Cuenta conciliada con un ajuste de ${formatCurrency(res.difference)}`
          : `Cuenta conciliada: ${plural(res.reconciledCount, "movimiento comprobado", "movimientos comprobados")}`,
      );
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle>Conciliar «{account?.name}»</DialogTitle>
          <DialogDescription>Comprueba que lo liquidado aquí coincide con lo que dice tu banco hoy.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-5 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
            <span className="text-muted-foreground">Saldo liquidado en SueldIA</span>
            <span className="font-semibold tabular-nums text-foreground">
              {isLoading || cleared == null ? <Loader2 className="size-4 animate-spin" /> : formatCurrency(cleared)}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reconcile-statement">Saldo que indica tu banco</Label>
            <DecimalInput id="reconcile-statement" value={statement} onValueChange={setStatement} placeholder="0,00" className="tabular-nums" autoFocus />
          </div>

          {difference !== null && (
            difference === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> Cuadra. Los movimientos liquidados quedarán como conciliados.
              </p>
            ) : (
              <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                  <Scale className="size-4 shrink-0" aria-hidden="true" /> Diferencia de {formatCurrency(difference)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Suele ser un movimiento sin apuntar o uno pendiente que el banco ya cobró.
                  {account && account.unclearedCount > 0 && ` Tienes ${plural(account.unclearedCount, "movimiento pendiente", "movimientos pendientes")} en esta cuenta.`}
                </p>
                {account && (
                  <a
                    href={transactionsHref({ accountId: account.id, cleared: "false" })}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
                  >
                    Revisar pendientes
                  </a>
                )}
              </div>
            )
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
          {difference !== null && difference !== 0 ? (
            <Button type="button" onClick={() => mutation.mutate(true)} disabled={mutation.isPending}>
              Crear ajuste y conciliar
            </Button>
          ) : (
            <Button type="button" onClick={() => mutation.mutate(false)} disabled={difference !== 0 || mutation.isPending}>
              Conciliar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
