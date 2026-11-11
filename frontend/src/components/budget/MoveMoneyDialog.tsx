import { useEffect, useState } from "react";
import type { BudgetSummary } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { DecimalInput } from "../app";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30";

/**
 * Mover dinero disponible de una categoría a otra en cualquier momento (antes
 * solo se podía para cubrir un sobregasto).
 */
export function MoveMoneyDialog({
  open, summary, pending, onClose, onConfirm,
}: {
  open: boolean;
  summary: BudgetSummary;
  pending: boolean;
  onClose: () => void;
  onConfirm: (fromId: number, toId: number, amount: number) => void;
}) {
  const categories = summary.groups.flatMap((g) => g.categories.map((c) => ({ ...c, groupName: g.name })));
  const sources = categories.filter((c) => c.available > 0.005);
  const [fromId, setFromId] = useState<number | "">("");
  const [toId, setToId] = useState<number | "">("");
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    if (open) { setFromId(""); setToId(""); setAmount(null); }
  }, [open]);

  const from = categories.find((c) => c.id === fromId);
  const valid = fromId !== "" && toId !== "" && fromId !== toId && amount != null && Number.isFinite(amount) && amount > 0
    && !!from && amount <= from.available + 0.005;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); if (valid) onConfirm(Number(fromId), Number(toId), amount!); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mover dinero entre categorías</DialogTitle>
            <DialogDescription>Pasa disponible de una categoría a otra este mes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="move-from">Desde</Label>
            <select id="move-from" className={selectClass} value={fromId} onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Elige una categoría con dinero…</option>
              {sources.map((c) => <option key={c.id} value={c.id}>{c.groupName} · {c.name} ({formatCurrency(c.available)})</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-to">Hacia</Label>
            <select id="move-to" className={selectClass} value={toId} onChange={(e) => setToId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Elige la categoría de destino…</option>
              {categories.filter((c) => c.id !== fromId).map((c) => <option key={c.id} value={c.id}>{c.groupName} · {c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="move-amount">Importe (€)</Label>
            <DecimalInput id="move-amount" value={amount} onValueChange={setAmount} placeholder="0,00" />
            {from && (
              <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setAmount(Math.round(from.available * 100) / 100)}>
                Todo lo disponible ({formatCurrency(from.available)})
              </button>
            )}
            {from && amount != null && amount > from.available + 0.005 && (
              <p role="alert" className="text-xs text-destructive">No puedes mover más de lo que tiene disponible.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!valid || pending}>{pending ? "Moviendo…" : "Mover"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
