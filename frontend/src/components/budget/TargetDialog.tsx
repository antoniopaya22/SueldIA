import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "../app";
import type { BudgetTargetInput, BudgetTargetType, CategoryBudget } from "../../lib/api";

interface Props {
  category: CategoryBudget | null;
  /** Mes que se está viendo, "YYYY-MM": propone la fecha límite a partir de él. */
  month: string;
  pending: boolean;
  onClose: () => void;
  onSave: (target: BudgetTargetInput) => void;
  onRemove: () => void;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Crear, cambiar o quitar el objetivo de una categoría. */
export function TargetDialog({ category, month, pending, onClose, onSave, onRemove }: Props) {
  return (
    <Dialog open={!!category} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        {/* Se remonta por categoría: el formulario siempre arranca con SU objetivo. */}
        {category && <TargetForm key={category.id} category={category} month={month} pending={pending} onClose={onClose} onSave={onSave} onRemove={onRemove} />}
      </DialogContent>
    </Dialog>
  );
}

function TargetForm({ category, month, pending, onClose, onSave, onRemove }: Omit<Props, "category"> & { category: CategoryBudget }) {
  const existing = category.target;
  const [type, setType] = useState<BudgetTargetType>(existing?.type ?? "monthly");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [targetMonth, setTargetMonth] = useState(existing?.targetMonth ?? addMonths(month, 3));
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { setError("Indica un importe mayor que cero"); return; }
    if (type === "by_date" && !/^\d{4}-\d{2}$/.test(targetMonth)) { setError("Elige el mes límite"); return; }
    onSave({ type, amount: value, targetMonth: type === "by_date" ? targetMonth : null });
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
        <DialogTitle>Objetivo de «{category.name}»</DialogTitle>
        <DialogDescription>
          Te dice cuánto asignar cada mes y cuánto te falta. No mueve dinero por sí solo.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 px-5 py-5">
        <Segmented
          aria-label="Tipo de objetivo"
          size="md"
          value={type}
          onChange={setType}
          options={[
            { value: "monthly", label: "Cada mes" },
            { value: "by_date", label: "Para una fecha" },
          ]}
        />

        <div className="space-y-1.5">
          <Label htmlFor="target-amount">{type === "monthly" ? "Importe a asignar cada mes (€)" : "Importe que quieres reunir (€)"}</Label>
          <Input
            id="target-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            autoFocus
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(""); }}
            placeholder={type === "monthly" ? "Ej.: 200" : "Ej.: 1200"}
            className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-invalid={!!error}
          />
        </div>

        {type === "by_date" && (
          <div className="space-y-1.5">
            <Label htmlFor="target-month">Antes de (mes)</Label>
            <Input id="target-month" type="month" value={targetMonth} onChange={(e) => { setTargetMonth(e.target.value); setError(""); }} />
            <p className="text-xs text-muted-foreground">
              Lo que falte se reparte entre los meses que quedan hasta esa fecha, este incluido.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </div>

      <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3 sm:justify-between">
        {existing ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={onRemove} className="text-destructive hover:text-destructive">
            Quitar objetivo
          </Button>
        ) : <span />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar objetivo"}</Button>
        </div>
      </DialogFooter>
    </form>
  );
}
