import type { Account, CategoryGroup, RecurringCadence } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AccountSelect, CategorySelect, CADENCE_LABELS, TypeToggle, amountInputClass, formatCadence } from "./shared";

export interface RecurringForm {
  type: "expense" | "income";
  accountId: number | "";
  categoryId: number | "";
  amount: string;
  cadence: RecurringCadence;
  intervalCount: number;
  startDate: string;
  endDate: string;
  payee: string;
  memo: string;
  /** Domiciliación: se liquida sola el día del cargo. */
  autoSettle: boolean;
}

interface Props {
  open: boolean;
  editing: boolean;
  form: RecurringForm;
  setForm: (f: RecurringForm) => void;
  accounts: Account[];
  groups: CategoryGroup[];
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

const TYPES = ["expense", "income"] as const;
const UNIT: Record<RecurringCadence, [string, string]> = {
  weekly: ["semana", "semanas"],
  monthly: ["mes", "meses"],
  yearly: ["año", "años"],
};

export function RecurringDialog({ open, editing, form, setForm, accounts, groups, pending, onClose, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
            <DialogTitle>{editing ? "Editar pago recurrente" : "Programar pago recurrente"}</DialogTitle>
            <DialogDescription>
              Las instancias se crean como pendientes y no afectan al saldo hasta que las marques como liquidadas, salvo las de las reglas automáticas, que se liquidan solas el día del cargo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-5 py-5">
            <TypeToggle value={form.type} types={TYPES} onChange={(t) => setForm({ ...form, type: t })} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rec-amount">Importe</Label>
                <div className="relative">
                  <Input
                    id="rec-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0,00"
                    className={amountInputClass}
                    required
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-payee">Beneficiario</Label>
                <Input id="rec-payee" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} placeholder="Ej: Alquiler o Nómina" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-account">Cuenta</Label>
                <AccountSelect id="rec-account" value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} accounts={accounts} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-category">Categoría</Label>
                <CategorySelect id="rec-category" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} groups={groups} />
              </div>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Periodicidad</legend>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-cadence">Frecuencia</Label>
                  <Select value={form.cadence} onValueChange={(v) => v && setForm({ ...form, cadence: v as RecurringCadence })}>
                    <SelectTrigger id="rec-cadence" className="w-full bg-card">
                      <SelectValue>{(v: string) => CADENCE_LABELS[v as RecurringCadence] ?? v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-interval">Cada</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="rec-interval"
                      type="number"
                      min="1"
                      max="12"
                      step="1"
                      value={form.intervalCount}
                      onChange={(e) => setForm({ ...form, intervalCount: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                      className="w-16 bg-card tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">{UNIT[form.cadence][form.intervalCount === 1 ? 0 : 1]}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-start">Primer pago</Label>
                  <Input id="rec-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="bg-card" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-end">Hasta (opcional)</Label>
                  <Input id="rec-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="bg-card" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatCadence(form.cadence, form.intervalCount)}{form.endDate ? " hasta la fecha indicada" : ", sin fecha de fin"}.
              </p>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="rec-memo">Nota</Label>
              <Input id="rec-memo" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="Opcional" />
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="rec-auto"
                checked={form.autoSettle}
                onCheckedChange={(checked) => setForm({ ...form, autoSettle: checked === true })}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="rec-auto" className="cursor-pointer">Liquidar automáticamente el día del cargo</Label>
                <p className="text-xs text-muted-foreground">
                  Para domiciliaciones: llegado el día, el movimiento pasa solo a tu saldo. Si no, queda pendiente hasta que lo marques.
                </p>
              </div>
            </div>

            {editing && (
              <p className="text-xs text-muted-foreground">Al guardar, se regenerarán las instancias pendientes de esta regla.</p>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : editing ? "Guardar cambios" : "Programar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
