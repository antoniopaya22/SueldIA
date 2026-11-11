import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  setRecurringTransactionActive,
  updateRecurringTransaction,
  type Account,
  type CategoryGroup,
  type RecurringTransaction,
  type SubscriptionSuggestion,
  type Transaction,
} from "../../../lib/api";
import { invalidateFinance } from "../../../lib/finance-cache";
import { ConfirmModal } from "../../ui/ConfirmModal";
import { RecurringDialog, type RecurringForm } from "./RecurringDialog";
import { getNextMonthlyOccurrence } from "./shared";

export function emptyRecurringForm(today: string, accountId: number | null): RecurringForm {
  return {
    type: "expense", accountId: accountId ?? "", categoryId: "", amount: "", cadence: "monthly",
    intervalCount: 1, startDate: today, endDate: "", payee: "", memo: "", autoSettle: false,
  };
}

/** Importe mensual equivalente de una regla (para el compromiso mensual). */
export function monthlyEquivalent(rule: RecurringTransaction) {
  const perYear = rule.cadence === "weekly" ? 52 : rule.cadence === "yearly" ? 1 : 12;
  return (rule.amount * perYear) / 12 / Math.max(1, rule.intervalCount);
}

interface Options {
  today: string;
  /** Cuenta filtrada en Transacciones: la propuesta al programar uno nuevo. */
  selectedAccountId: number | null;
  accounts: Account[];
  categoryGroups: CategoryGroup[];
}

/**
 * Programar, editar, pausar y borrar pagos recurrentes: el estado del
 * formulario, las mutaciones y los diálogos (`dialogs`, a pintar una vez).
 */
export function useRecurringEditor({ today, selectedAccountId, accounts, categoryGroups }: Options) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RecurringForm>(() => emptyRecurringForm(today, null));
  const [deleteTarget, setDeleteTarget] = useState<RecurringTransaction | null>(null);

  const close = () => {
    setOpen(false);
    setEditingId(null);
    setForm(emptyRecurringForm(today, selectedAccountId));
  };
  const openWith = (next: RecurringForm, id: number | null = null) => {
    setEditingId(id);
    setForm(next);
    setOpen(true);
  };

  // Crear/editar/pausar una regla genera o borra movimientos: refresca todo lo
  // que depende de ellos (saldos de las cuentas, "Sin liquidar"…), no solo la lista.
  const invalidate = () => invalidateFinance(queryClient);

  const createMut = useMutation({
    mutationFn: createRecurringTransaction,
    onSuccess: (_, vars) => { invalidate(); close(); toast.success(vars.type === "transfer" ? "Traspaso recurrente programado" : "Pago recurrente programado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateRecurringTransaction>[1] }) => updateRecurringTransaction(id, data),
    onSuccess: () => { invalidate(); close(); toast.success("Pago recurrente actualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setRecurringTransactionActive(id, active),
    onSuccess: (_, v) => { invalidate(); toast.success(v.active ? "Pago recurrente reactivado" : "Pago recurrente pausado"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: deleteRecurringTransaction,
    onSuccess: () => { invalidate(); toast.success("Pago recurrente eliminado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => openWith(emptyRecurringForm(today, selectedAccountId));

  const openEdit = (rule: RecurringTransaction) =>
    openWith({
      type: rule.type,
      accountId: rule.accountId,
      targetAccountId: rule.targetAccountId ?? "",
      categoryId: rule.categoryId ?? "",
      amount: rule.amount.toFixed(2),
      cadence: rule.cadence,
      intervalCount: rule.intervalCount,
      startDate: rule.startDate,
      endDate: rule.endDate ?? "",
      payee: rule.payee ?? "",
      memo: rule.memo ?? "",
      autoSettle: rule.autoSettle,
    }, rule.id);

  // Una suscripción detectada se programa con lo que ya sabemos de ella; el usuario revisa y confirma.
  const openFromSuggestion = (s: SubscriptionSuggestion) =>
    openWith({
      type: "expense",
      accountId: s.accountId,
      categoryId: s.categoryId ?? "",
      amount: s.amount.toFixed(2),
      cadence: s.cadence,
      intervalCount: 1,
      startDate: s.nextDate,
      endDate: "",
      payee: s.payee,
      memo: "",
      autoSettle: false,
    });

  const openFromTransaction = (tx: Transaction) => {
    if (tx.type === "transfer" || tx.recurringTransactionId) return;
    openWith({
      type: tx.type === "income" ? "income" : "expense",
      accountId: tx.accountId,
      categoryId: tx.categoryId ?? "",
      amount: tx.amount.toFixed(2),
      cadence: "monthly",
      intervalCount: 1,
      startDate: getNextMonthlyOccurrence(tx.date, today),
      endDate: "",
      payee: tx.payee ?? "",
      memo: tx.memo ?? "",
      autoSettle: false,
    });
  };

  const submit = () => {
    const accountId = form.accountId || selectedAccountId;
    if (!accountId || !form.amount) {
      toast.error("Selecciona una cuenta e importe");
      return;
    }
    if (form.type === "transfer" && (!form.targetAccountId || form.targetAccountId === Number(accountId))) {
      toast.error("Elige la cuenta que recibe el traspaso");
      return;
    }
    const payload = {
      accountId: Number(accountId),
      categoryId: form.type === "transfer" ? null : form.categoryId ? Number(form.categoryId) : null,
      targetAccountId: form.type === "transfer" ? Number(form.targetAccountId) : null,
      type: form.type,
      amount: Number(form.amount),
      cadence: form.cadence,
      intervalCount: form.intervalCount,
      startDate: form.startDate,
      endDate: form.endDate || null,
      payee: form.payee || null,
      memo: form.memo || null,
      autoSettle: form.autoSettle,
      ...(editingId ? {} : { backfill: form.backfill === true }),
    };
    if (editingId) updateMut.mutate({ id: editingId, data: payload });
    else createMut.mutate(payload);
  };

  const dialogs = (
    <>
      <RecurringDialog
        open={open}
        editing={!!editingId}
        form={form}
        setForm={setForm}
        accounts={accounts}
        groups={categoryGroups}
        pending={createMut.isPending || updateMut.isPending}
        onClose={close}
        onSubmit={submit}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Eliminar programación recurrente"
        message={`¿Eliminar la programación recurrente de ${deleteTarget?.payee || "este movimiento"}?`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (deleteTarget) deleteMut.mutate(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );

  return {
    isOpen: open,
    /** Una categoría recién creada desde el formulario pasa a ser la elegida. */
    setCategory: (categoryId: number) => setForm((f) => ({ ...f, categoryId })),
    openCreate,
    openEdit,
    openFromSuggestion,
    openFromTransaction,
    toggleActive: (rule: RecurringTransaction) => toggleActiveMut.mutate({ id: rule.id, active: !rule.active }),
    askDelete: setDeleteTarget,
    dialogs,
  };
}
