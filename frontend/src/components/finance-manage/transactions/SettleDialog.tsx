import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Transaction } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { amountInputClass } from "./shared";

interface Props {
  transaction: Transaction | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}

/** Liquidar un cargo programado con el importe real (recibos variables: luz, agua, tarjeta…). */
export function SettleDialog({ transaction, pending, onClose, onConfirm }: Props) {
  return (
    <Dialog open={!!transaction} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        {transaction && <SettleForm key={transaction.id} transaction={transaction} pending={pending} onClose={onClose} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function SettleForm({ transaction, pending, onClose, onConfirm }: Omit<Props, "transaction"> & { transaction: Transaction }) {
  const [amount, setAmount] = useState(transaction.amount.toFixed(2));
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { setError("Indica un importe mayor que cero"); return; }
    onConfirm(value);
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
        <DialogTitle>Liquidar con otro importe</DialogTitle>
        <DialogDescription>
          {transaction.payee || "Este movimiento"} estaba previsto por {formatCurrency(transaction.amount)}. Pon lo que ha costado de verdad.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5 px-5 py-5">
        <Label htmlFor="settle-amount">Importe real</Label>
        <div className="relative">
          <Input
            id="settle-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            autoFocus
            value={amount}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => { setAmount(e.target.value); setError(""); }}
            className={`h-11 text-lg font-semibold ${amountInputClass}`}
            aria-invalid={!!error}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-base text-muted-foreground">€</span>
        </div>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Liquidar"}</Button>
      </DialogFooter>
    </form>
  );
}
