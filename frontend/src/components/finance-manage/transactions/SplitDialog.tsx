import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryGroup, SplitPart, Transaction } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { CategorySelect, amountInputClass } from "./shared";
import { cn } from "cn";

const MAX_PARTS = 20;
const cents = (n: number) => Math.round(n * 100);
const parse = (v: string) => Number(v.replace(",", "."));

interface DraftPart {
  categoryId: number | "";
  amount: string;
}

interface Props {
  transaction: Transaction | null;
  groups: CategoryGroup[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (parts: SplitPart[]) => void;
}

/** Repartir un gasto entre varias categorías (p. ej. un ticket de súper con droguería). */
export function SplitDialog({ transaction, groups, pending, onClose, onConfirm }: Props) {
  return (
    <Dialog open={!!transaction} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        {transaction && <SplitForm key={transaction.id} transaction={transaction} groups={groups} pending={pending} onClose={onClose} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function SplitForm({ transaction, groups, pending, onClose, onConfirm }: Omit<Props, "transaction"> & { transaction: Transaction }) {
  const total = transaction.amount;
  const [parts, setParts] = useState<DraftPart[]>([
    { categoryId: transaction.categoryId ?? "", amount: total.toFixed(2) },
    { categoryId: "", amount: "" },
  ]);

  const { remainingCents, allValid } = useMemo(() => {
    const amounts = parts.map((p) => parse(p.amount));
    const sum = amounts.reduce((s, a) => s + (Number.isFinite(a) && a > 0 ? cents(a) : 0), 0);
    return {
      remainingCents: cents(total) - sum,
      allValid: amounts.every((a) => Number.isFinite(a) && a > 0),
    };
  }, [parts, total]);

  const remaining = remainingCents / 100;
  const canSubmit = allValid && remainingCents === 0 && parts.length >= 2;

  const update = (index: number, patch: Partial<DraftPart>) =>
    setParts((cur) => cur.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  // "Completar": mete en esa parte lo que falta (o lo que sobra) para que todo cuadre.
  const complete = (index: number) => {
    const others = parts.reduce((s, p, i) => s + (i === index ? 0 : Math.max(0, cents(parse(p.amount) || 0))), 0);
    const value = (cents(total) - others) / 100;
    if (value > 0) update(index, { amount: value.toFixed(2) });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm(parts.map((p) => ({ categoryId: p.categoryId === "" ? null : p.categoryId, amount: parse(p.amount) })));
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
        <DialogTitle>Dividir «{transaction.payee || "movimiento"}»</DialogTitle>
        <DialogDescription>
          Reparte {formatCurrency(total)} entre varias categorías. El saldo no cambia: solo cómo se cuenta en el presupuesto y los informes.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2.5 px-5 py-5">
        {parts.map((part, i) => (
          <div key={i} className="flex items-center gap-2">
            <CategorySelect
              value={part.categoryId}
              onChange={(categoryId) => update(i, { categoryId })}
              groups={groups}
              noneLabel="Sin categoría"
              className="min-w-0 flex-1"
            />
            <div className="relative w-32 shrink-0">
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={part.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                aria-label={`Importe de la parte ${i + 1}`}
                placeholder="0,00"
                className={cn("pr-7 text-right", amountInputClass)}
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">€</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => complete(i)}
              disabled={remainingCents === 0}
              title="Completar esta parte con lo que falta"
              aria-label={`Completar la parte ${i + 1} con lo que falta`}
              className="shrink-0 text-xs font-medium text-primary-700 dark:text-primary"
            >
              =
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setParts((cur) => cur.filter((_, idx) => idx !== i))}
              disabled={parts.length <= 2}
              aria-label={`Quitar la parte ${i + 1}`}
              className="shrink-0 text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setParts((cur) => [...cur, { categoryId: "", amount: "" }])}
          disabled={parts.length >= MAX_PARTS}
          className="gap-1.5"
        >
          <Plus className="size-4" /> Añadir parte
        </Button>

        <p
          className={cn(
            "rounded-lg border px-3 py-2 text-sm tabular-nums",
            remainingCents === 0 && allValid ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300" : "border-border bg-muted/30 text-muted-foreground",
          )}
          role="status"
        >
          {remainingCents === 0
            ? allValid ? "Todo repartido." : "Cada parte necesita un importe: baja la primera y completa las demás con «=»."
            : remaining > 0
              ? <>Faltan <strong className="text-foreground">{formatCurrency(remaining)}</strong> por repartir.</>
              : <>Te pasas <strong className="text-red-600 dark:text-red-400">{formatCurrency(Math.abs(remaining))}</strong>.</>}
        </p>
      </div>

      <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={!canSubmit || pending}>{pending ? "Dividiendo…" : "Dividir gasto"}</Button>
      </DialogFooter>
    </form>
  );
}
