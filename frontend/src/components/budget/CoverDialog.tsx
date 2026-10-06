import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { BudgetSummary, CategoryBudget } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

/** Origen del dinero: otra categoría, o lo que aún no está asignado ("Para presupuestar"). */
export const READY_TO_ASSIGN = "ready";

interface Props {
  /** Categoría pasada de presupuesto que se quiere cubrir. */
  category: CategoryBudget | null;
  summary: BudgetSummary;
  pending: boolean;
  onClose: () => void;
  onConfirm: (source: typeof READY_TO_ASSIGN | number, amount: number) => void;
}

export function CoverDialog({ category, summary, pending, onClose, onConfirm }: Props) {
  return (
    <Dialog open={!!category} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        {category && <CoverForm key={category.id} category={category} summary={summary} pending={pending} onClose={onClose} onConfirm={onConfirm} />}
      </DialogContent>
    </Dialog>
  );
}

function CoverForm({ category, summary, pending, onClose, onConfirm }: Omit<Props, "category"> & { category: CategoryBudget }) {
  const overspent = Math.round(-category.available * 100) / 100;

  // Orígenes posibles y cuánto hay disponible en cada uno.
  const sources = useMemo(() => {
    const list: { value: string; label: string; available: number }[] = [];
    if (summary.readyToAssign > 0.005) {
      list.push({ value: READY_TO_ASSIGN, label: "Para presupuestar", available: summary.readyToAssign });
    }
    for (const g of summary.groups) {
      for (const c of g.categories) {
        if (c.id !== category.id && c.available > 0.005) {
          list.push({ value: String(c.id), label: `${g.name} · ${c.name}`, available: c.available });
        }
      }
    }
    return list;
  }, [summary, category.id]);

  const [source, setSource] = useState(sources[0]?.value ?? "");
  const selected = sources.find((s) => s.value === source);
  const [amount, setAmount] = useState(() => {
    const first = sources[0];
    return first ? String(Math.min(overspent, Math.floor(first.available * 100) / 100)) : "";
  });
  const [error, setError] = useState("");

  const pickSource = (value: string) => {
    setSource(value);
    const s = sources.find((x) => x.value === value);
    if (s) setAmount(String(Math.min(overspent, Math.floor(s.available * 100) / 100)));
    setError("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(",", "."));
    if (!selected) return;
    if (!Number.isFinite(value) || value <= 0) { setError("Indica un importe mayor que cero"); return; }
    if (value > selected.available + 0.005) { setError(`Ahí solo hay ${formatCurrency(selected.available)} disponibles`); return; }
    onConfirm(source === READY_TO_ASSIGN ? READY_TO_ASSIGN : Number(source), value);
  };

  return (
    <form onSubmit={submit}>
      <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
        <DialogTitle>Cubrir «{category.name}»</DialogTitle>
        <DialogDescription>
          Te has pasado {formatCurrency(overspent)}. Pasa dinero que ya tienes disponible para dejarla a cero.
        </DialogDescription>
      </DialogHeader>

      {sources.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          Ahora mismo no hay dinero disponible en ninguna categoría ni sin asignar. Recorta el gasto de otra categoría o asigna más dinero desde «Para presupuestar» cuando entre un ingreso.
        </p>
      ) : (
        <div className="space-y-5 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="cover-source">Coger de</Label>
            <Select value={source} onValueChange={(v) => v && pickSource(v)}>
              <SelectTrigger id="cover-source" className="w-full">
                <SelectValue>{(v: string) => sources.find((s) => s.value === v)?.label ?? "Elige el origen"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="flex flex-1 items-center justify-between gap-4">
                      {s.label}
                      <span className="text-xs text-muted-foreground tabular-nums">{formatCurrency(s.available)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cover-amount">Importe (€)</Label>
            <Input
              id="cover-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(""); }}
              className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-invalid={!!error}
            />
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        </div>
      )}

      <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        {sources.length > 0 && <Button type="submit" disabled={pending}>{pending ? "Moviendo…" : "Cubrir"}</Button>}
      </DialogFooter>
    </form>
  );
}
