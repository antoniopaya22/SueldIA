import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCategoryRule, getAccounts, previewCategoryRule, updateCategoryRule,
  type CategoryGroup, type CategoryRule, type CategoryRuleInput,
} from "../../lib/api";
import { plural } from "../../lib/format";
import { DecimalInput } from "../app";
import { CategorySelect } from "../finance-manage/transactions/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const selectClass = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30";

/**
 * Crear o editar una regla con condiciones opcionales, viendo antes a cuántos
 * movimientos afecta (antes solo se podía «el beneficiario contiene», sin
 * editar ni saber qué iba a tocar).
 */
export function RuleDialog({
  open, rule, groups, onClose,
}: {
  open: boolean;
  rule: CategoryRule | null;
  groups: CategoryGroup[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts, enabled: open });
  const [form, setForm] = useState<CategoryRuleInput>({ match: "", categoryId: 0, matchField: "payee" });
  const [debounced, setDebounced] = useState<CategoryRuleInput | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(rule
      ? { match: rule.match, categoryId: rule.categoryId, matchField: rule.matchField, transactionType: rule.transactionType, minAmount: rule.minAmount, maxAmount: rule.maxAmount, accountId: rule.accountId }
      : { match: "", categoryId: 0, matchField: "payee" });
  }, [open, rule]);

  const valid = form.match.trim().length >= 2 && form.categoryId > 0
    && (form.minAmount == null || form.maxAmount == null || form.minAmount <= form.maxAmount);

  useEffect(() => {
    if (!valid) { setDebounced(null); return; }
    const t = setTimeout(() => setDebounced(form), 400);
    return () => clearTimeout(t);
  }, [form, valid]);

  const { data: preview, isFetching } = useQuery({
    queryKey: ["rule-preview", debounced],
    queryFn: () => previewCategoryRule(debounced!),
    enabled: open && !!debounced,
  });

  const saveMut = useMutation({
    mutationFn: () => (rule ? updateCategoryRule(rule.id, form) : createCategoryRule(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["category-rules"] });
      toast.success(rule ? "Regla actualizada" : "Regla guardada");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (patch: Partial<CategoryRuleInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle>{rule ? "Editar regla" : "Nueva regla"}</DialogTitle>
          <DialogDescription>Se aplica a los movimientos nuevos sin categoría que cumplan todas las condiciones.</DialogDescription>
        </DialogHeader>
        <form id="rule-form" onSubmit={(e) => { e.preventDefault(); if (valid) saveMut.mutate(); }} className="space-y-4 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="rule-field">Si</Label>
              <select id="rule-field" className={selectClass} value={form.matchField} onChange={(e) => set({ matchField: e.target.value as CategoryRuleInput["matchField"] })}>
                <option value="payee">el beneficiario</option>
                <option value="memo">la nota</option>
                <option value="any">beneficiario o nota</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-match">contiene</Label>
              <Input id="rule-match" value={form.match} onChange={(e) => set({ match: e.target.value })} placeholder="ej.: mercadona" maxLength={100} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-category">la categoría es</Label>
            <CategorySelect id="rule-category" value={form.categoryId || ""} onChange={(v) => set({ categoryId: v === "" ? 0 : v })} groups={groups} noneLabel="Elige la categoría" />
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Condiciones opcionales</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rule-type">Tipo</Label>
                <select id="rule-type" className={selectClass} value={form.transactionType ?? ""} onChange={(e) => set({ transactionType: (e.target.value || null) as CategoryRuleInput["transactionType"] })}>
                  <option value="">Gastos e ingresos</option>
                  <option value="expense">Solo gastos</option>
                  <option value="income">Solo ingresos</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-account">Cuenta</Label>
                <select id="rule-account" className={selectClass} value={form.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Cualquier cuenta</option>
                  {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-min">Importe desde (€)</Label>
                <DecimalInput id="rule-min" value={form.minAmount ?? null} onValueChange={(v) => set({ minAmount: v != null && Number.isFinite(v) ? v : null })} placeholder="Sin mínimo" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rule-max">hasta (€)</Label>
                <DecimalInput id="rule-max" value={form.maxAmount ?? null} onValueChange={(v) => set({ maxAmount: v != null && Number.isFinite(v) ? v : null })} placeholder="Sin máximo" />
              </div>
            </div>
          </fieldset>

          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {!valid ? "Escribe el texto (2 letras o más) y elige la categoría."
              : isFetching || !preview ? "Comprobando…"
              : preview.matched === 0 ? "Ahora mismo no encaja con ningún movimiento."
              : `Encaja con ${plural(preview.matched, "movimiento", "movimientos")}${preview.uncategorized ? `, ${preview.uncategorized} sin categoría` : ""}.`}
          </p>
          {preview && preview.sample.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-auto text-xs text-muted-foreground">
              {preview.sample.map((t) => <li key={t.id} className="truncate">{t.date} · {t.payee}</li>)}
            </ul>
          )}
        </form>
        <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="rule-form" disabled={!valid || saveMut.isPending}>{rule ? "Guardar" : "Crear regla"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
