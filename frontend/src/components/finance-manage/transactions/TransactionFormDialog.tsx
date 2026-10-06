import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createTransaction, getAccounts, getCategories, updateTransaction, type Transaction,
} from "../../../lib/api";
import { invalidateFinance } from "../../../lib/finance-cache";
import { TransactionDialog, type TxForm } from "./TransactionDialog";
import { useQuickCategory } from "./useQuickCategory";
import { getTodayIsoDate, type TxType } from "./shared";

const LAST_ACCOUNT_KEY = "sueldia:last-account";

function readLastAccount(): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_ACCOUNT_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberAccount(id: number) {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, String(id));
  } catch {
    // Sin almacenamiento (modo privado…): simplemente no se recuerda.
  }
}

export function emptyTxForm(today: string, accountId: number | null, type: TxType = "expense"): TxForm {
  return {
    type, accountId: accountId ?? "", targetAccountId: "", categoryId: "", amount: "", date: today,
    payee: "", memo: "", cleared: true,
  };
}

function formFromTransaction(tx: Transaction): TxForm {
  return {
    type: tx.type,
    accountId: tx.accountId,
    targetAccountId: tx.type === "transfer" ? tx.targetAccountId ?? "" : "",
    categoryId: tx.type === "transfer" ? "" : tx.categoryId ?? "",
    amount: tx.amount.toFixed(2),
    date: tx.date,
    payee: tx.payee ?? "",
    memo: tx.memo ?? "",
    cleared: tx.cleared,
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Transacción a editar; `null` para crear una nueva. */
  editing: Transaction | null;
  /** Valores iniciales al crear (tipo, o los datos de la transacción duplicada). */
  initial?: Partial<TxForm>;
  /** Cuenta preseleccionada (la que está filtrando la página). */
  defaultAccountId?: number | null;
}

/**
 * Crear/editar una transacción: formulario + mutaciones + categoría rápida.
 * Autocontenido (carga cuentas y categorías por sí mismo) para poder abrirse
 * desde cualquier página de la app, no solo desde Transacciones.
 */
export function TransactionFormDialog({ open, onClose, editing, initial, defaultAccountId = null }: Props) {
  const queryClient = useQueryClient();
  const today = getTodayIsoDate();

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts, enabled: open });
  const { data: groups = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories, enabled: open });
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const canCreateTransfers = activeAccounts.length > 1;

  // Cuenta por defecto: la que filtra la página, la última usada o la única que hay.
  const defaultAccount = useMemo(() => {
    if (defaultAccountId && activeAccounts.some((a) => a.id === defaultAccountId)) return defaultAccountId;
    const last = readLastAccount();
    if (last && activeAccounts.some((a) => a.id === last)) return last;
    return activeAccounts.length === 1 ? activeAccounts[0].id : null;
  }, [defaultAccountId, activeAccounts]);

  const [form, setForm] = useState<TxForm>(() => emptyTxForm(today, null));

  // Reinicia el formulario justo al abrir (durante el render, no en un efecto:
  // así no hay un fotograma con los datos de la vez anterior).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(editing ? formFromTransaction(editing) : { ...emptyTxForm(today, defaultAccount), ...initial });
    }
  }

  // Las cuentas llegan después de abrir (carga bajo demanda): completa la cuenta cuando estén.
  useEffect(() => {
    if (open && !editing && form.accountId === "" && defaultAccount) {
      setForm((f) => (f.accountId === "" ? { ...f, accountId: defaultAccount } : f));
    }
  }, [open, editing, form.accountId, defaultAccount]);

  const quickCategory = useQuickCategory(groups, (category) =>
    setForm((f) => (f.type === "transfer" ? f : { ...f, categoryId: category.id })),
  );

  const addAnotherRef = useRef(false);

  const createMut = useMutation({
    mutationFn: createTransaction,
    onSuccess: (_created, vars) => {
      invalidateFinance(queryClient);
      rememberAccount(vars.accountId);
      if (addAnotherRef.current) {
        // Conserva tipo, cuenta y fecha (lo habitual al apuntar varios tickets seguidos).
        setForm((f) => ({ ...f, amount: "", payee: "", memo: "", categoryId: "" }));
        toast.success("Transacción creada. Añade la siguiente.");
        setTimeout(() => document.getElementById("tx-amount")?.focus(), 0);
      } else {
        onClose();
        toast.success("Transacción creada");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateTransaction>[1] }) => updateTransaction(id, data),
    onSuccess: () => {
      invalidateFinance(queryClient);
      onClose();
      toast.success("Transacción actualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (addAnother: boolean) => {
    const acctId = form.accountId || defaultAccountId;
    if (!acctId || !form.amount) {
      toast.error("Selecciona una cuenta e importe");
      return;
    }
    if (form.type === "transfer" && !form.targetAccountId) {
      toast.error("Selecciona una cuenta destino");
      return;
    }
    if (form.type === "transfer" && Number(acctId) === Number(form.targetAccountId)) {
      toast.error("La cuenta destino debe ser distinta de la cuenta origen");
      return;
    }
    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("El importe debe ser mayor que cero");
      return;
    }
    const payload = {
      accountId: Number(acctId),
      type: form.type,
      amount,
      date: form.date,
      payee: form.payee || null,
      memo: form.memo || null,
      cleared: form.cleared,
      categoryId: form.type === "transfer" ? null : form.categoryId ? Number(form.categoryId) : null,
      targetAccountId: form.type === "transfer" && form.targetAccountId ? Number(form.targetAccountId) : undefined,
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, data: payload });
    } else {
      addAnotherRef.current = addAnother;
      createMut.mutate(payload);
    }
  };

  return (
    <>
      <TransactionDialog
        open={open}
        editing={!!editing}
        form={form}
        setForm={setForm}
        accounts={activeAccounts}
        groups={groups}
        canCreateTransfers={canCreateTransfers}
        pending={createMut.isPending || updateMut.isPending}
        onClose={onClose}
        onSubmit={handleSubmit}
        onNewCategory={quickCategory.openDialog}
      />
      {quickCategory.dialog}
    </>
  );
}
