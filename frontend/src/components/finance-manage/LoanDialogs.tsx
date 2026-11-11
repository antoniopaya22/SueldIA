import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addValuation, deleteValuation, getAmortization, getValuations, type Account,
} from "../../lib/api";
import { invalidateFinance } from "../../lib/finance-cache";
import { formatCurrency, formatPct, formatRate } from "../../lib/format";
import { todayIso } from "../../lib/dates";
import { DecimalInput } from "../app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";

const fullDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
const monthYear = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { month: "short", year: "numeric" });

/** ¿Tiene el préstamo todos los datos para calcular el cuadro? */
export function hasLoanTerms(a: Account): boolean {
  return a.loanPrincipal != null && a.loanRate != null && a.loanTermMonths != null && a.loanStartDate != null;
}

// ─── Cuadro de amortización ─────────────────────────────────────
export function AmortizationDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["amortization", account?.id, account?.loanPrincipal, account?.loanRate, account?.loanTermMonths, account?.loanStartDate],
    queryFn: () => getAmortization(account!.id),
    enabled: !!account,
  });
  const p = data?.position;
  const total = data?.rows.length ?? 0;
  const actualDebt = account ? Math.max(0, -account.balance) : 0;
  const gap = p ? Math.round((actualDebt - p.theoreticalRemaining) * 100) / 100 : 0;

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cuadro de amortización</DialogTitle>
          <DialogDescription>
            {account?.name} · {account?.loanPrincipal != null && formatCurrency(account.loanPrincipal)} al {account?.loanRate != null && formatRate(account.loanRate)} TIN,
            {" "}{account?.loanTermMonths} cuotas. Sistema francés (cuota constante).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
        ) : error || !data || !p ? (
          <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "No se pudo calcular el cuadro."}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Cuota", value: formatCurrency(data.payment) },
                { label: "Capital pendiente", value: formatCurrency(p.theoreticalRemaining), hint: "Según el cuadro, a hoy" },
                { label: "Intereses que faltan", value: formatCurrency(p.interestRemaining), hint: `${formatCurrency(p.interestPaid)} ya pagados` },
                { label: "Última cuota", value: monthYear(p.endDate), hint: `Quedan ${p.remainingCount} de ${total}` },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">{m.label}</dt>
                  <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{m.value}</dd>
                  {m.hint && <dd className="text-[11px] text-muted-foreground">{m.hint}</dd>}
                </div>
              ))}
            </dl>

            <div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{p.paidCount} cuotas pagadas</span>
                <span>{formatPct(total ? (p.paidCount / total) * 100 : 0)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary-500 dark:bg-primary" style={{ width: `${total ? (p.paidCount / total) * 100 : 0}%` }} />
              </div>
            </div>

            {Math.abs(gap) >= 1 && (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                El saldo de la cuenta dice que debes {formatCurrency(actualDebt)}: {formatCurrency(Math.abs(gap))} {gap > 0 ? "más" : "menos"} que el cuadro
                {gap < 0 ? " (¿una amortización anticipada?)" : " (¿falta apuntar alguna cuota?)"}.
              </p>
            )}

            <div data-amortization-table className="max-h-80 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Nº</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Cuota</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Intereses</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Capital</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Pendiente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((r) => {
                    const next = r.n === p.nextPayment?.n;
                    return (
                      <tr
                        key={r.n}
                        // Al abrir, la tabla se coloca en la próxima cuota (no en la 1 de hace años).
                        ref={next ? (el) => { const box = el?.closest("[data-amortization-table]"); if (el && box) box.scrollTop = el.offsetTop - box.clientHeight / 2; } : undefined}
                        className={cn(r.n <= p.paidCount && "text-muted-foreground", next && "bg-primary/5 font-medium text-foreground")} aria-current={next ? "true" : undefined}>
                        <td className="px-3 py-1.5">{r.n}</td>
                        <td className="px-3 py-1.5">{fullDate(r.date)}{next && <span className="ml-1.5 text-[10px] text-primary-700 dark:text-primary">próxima</span>}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(r.payment)}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(r.interest)}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(r.principal)}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(r.remaining)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Intereses totales del préstamo: {formatCurrency(data.totalInterest)}. Es una estimación con interés fijo: si tu préstamo es variable o lleva comisiones, el banco puede dar cifras algo distintas.
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Actualizar valor (inversiones) ─────────────────────────────
export function ValuationDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = todayIso();
  const [value, setValue] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const { data: history = [] } = useQuery({
    queryKey: ["valuations", account?.id],
    queryFn: () => getValuations(account!.id),
    enabled: !!account,
  });

  const refresh = () => {
    invalidateFinance(queryClient);
    queryClient.invalidateQueries({ queryKey: ["valuations", account?.id] });
  };
  const close = () => { setValue(null); setDate(today); onClose(); };
  const saveMut = useMutation({
    mutationFn: () => addValuation(account!.id, { value: value!, date }),
    onSuccess: () => { refresh(); toast.success("Valor actualizado"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteValuation(account!.id, id),
    onSuccess: () => { refresh(); toast.success("Valoración eliminada"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = value != null && Number.isFinite(value) && date <= today;
  const change = valid && account ? value - account.balance : null;

  return (
    <Dialog open={!!account} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (valid) saveMut.mutate(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Actualizar valor</DialogTitle>
            <DialogDescription>
              Lo que vale hoy {account?.name}. No crea ningún movimiento ni cuenta como ingreso o gasto: solo fija el saldo desde esa fecha.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="valuation-value">Valor (€)</Label>
              <DecimalInput id="valuation-value" value={value} onValueChange={setValue} placeholder={account ? String(account.balance).replace(".", ",") : "0"} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valuation-date">Fecha</Label>
              <Input id="valuation-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
            </div>
          </div>
          {change != null && account && (
            <p className={cn("text-sm tabular-nums", change < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {change === 0 ? "Igual que el saldo actual." : `${change > 0 ? "+" : "−"}${formatCurrency(Math.abs(change))} frente al saldo actual (${formatCurrency(account.balance)}).`}
            </p>
          )}
          {history.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Valoraciones anteriores</h3>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {[...history].reverse().map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="flex-1 text-muted-foreground">{fullDate(v.date)}</span>
                    <span className="font-medium tabular-nums text-foreground">{formatCurrency(v.value)}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Eliminar la valoración del ${fullDate(v.date)}`} onClick={() => deleteMut.mutate(v.id)} disabled={deleteMut.isPending}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={!valid || saveMut.isPending} className="gap-1.5">
              {saveMut.isPending && <Loader2 className="size-4 animate-spin" />}
              Guardar valor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
