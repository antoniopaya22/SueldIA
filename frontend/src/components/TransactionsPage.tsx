import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, Plus, Search, ArrowLeftRight, Repeat, Download, ChevronLeft, ChevronRight,
  MoreHorizontal, Tag, TrendingUp, TrendingDown, Scale, ListChecks, X, CalendarRange,
  AlertTriangle, PiggyBank, Wallet,
} from "lucide-react";
import {
  batchTransactions,
  createRecurringTransaction,
  deleteRecurringTransaction,
  deleteTransaction,
  exportTransactions,
  getAccounts,
  getCategories,
  getRecurringTransactions,
  getTransactions,
  setRecurringTransactionActive,
  toggleCleared,
  updateRecurringTransaction,
  type RecurringTransaction,
  type Transaction,
  type TransactionFilters,
} from "../lib/api";
import { Providers } from "./Providers";
import { toast } from "sonner";
import { formatCurrency } from "../lib/format";
import { invalidateFinance } from "../lib/finance-cache";
import { useTransactionFilters } from "../hooks/use-transaction-filters";
import { PERIOD_LABELS, activePeriod, periodRange, type PeriodKey } from "../lib/transaction-filters";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import {
  PageHeader, StatCard, StatGrid, SectionCard, Segmented,
  PageHeaderSkeleton, StatCardSkeleton,
} from "./app";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { darkBoost } from "../lib/color";
import {
  CategorySelect, FilterChip, NONE, getNextMonthlyOccurrence, getTodayIsoDate, type TxType,
} from "./finance-manage/transactions/shared";
import type { TxForm } from "./finance-manage/transactions/TransactionDialog";
import { TransactionFormDialog } from "./finance-manage/transactions/TransactionFormDialog";
import { useQuickCategory } from "./finance-manage/transactions/useQuickCategory";
import { RecurringDialog, type RecurringForm } from "./finance-manage/transactions/RecurringDialog";
import { AmountRangeFilter } from "./finance-manage/transactions/AmountRangeFilter";
import { BulkActionBar } from "./finance-manage/transactions/BulkActionBar";
import { RecurringRuleCard } from "./finance-manage/transactions/RecurringRuleCard";
import { TransactionTable, type SortDir, type SortField } from "./finance-manage/transactions/TransactionTable";
import { cn } from "cn";

const PAGE_SIZE = 50;

const SORT_OPTIONS: { value: string; label: string; field: SortField; dir: SortDir }[] = [
  { value: "date:desc", label: "Más recientes", field: "date", dir: "desc" },
  { value: "date:asc", label: "Más antiguas", field: "date", dir: "asc" },
  { value: "amount:desc", label: "Importe mayor", field: "amount", dir: "desc" },
  { value: "amount:asc", label: "Importe menor", field: "amount", dir: "asc" },
  { value: "payee:asc", label: "Beneficiario (A-Z)", field: "payee", dir: "asc" },
  { value: "category:asc", label: "Categoría (A-Z)", field: "category", dir: "asc" },
];

const CLEARED_LABELS: Record<string, string> = { [NONE]: "Cualquier estado", true: "Liquidadas", false: "Pendientes" };

function emptyRecurringForm(today: string, accountId: number | null): RecurringForm {
  return {
    type: "expense", accountId: accountId ?? "", categoryId: "", amount: "", cadence: "monthly",
    intervalCount: 1, startDate: today, endDate: "", payee: "", memo: "",
  };
}

// Importe mensual equivalente de una regla (para el compromiso mensual).
function monthlyEquivalent(rule: RecurringTransaction) {
  const perYear = rule.cadence === "weekly" ? 52 : rule.cadence === "yearly" ? 1 : 12;
  return (rule.amount * perYear) / 12 / Math.max(1, rule.intervalCount);
}

function TransactionsView() {
  const queryClient = useQueryClient();
  const today = getTodayIsoDate();

  // ─── Filtros y vista ─────────────────────────────────────────
  const [tab, setTab] = useState<"movements" | "recurring">("movements");
  // Los filtros viven en la URL (?cuenta=…&categoria=…): compartibles, recargables y enlazables desde gráficos.
  const { filters: urlFilters, update: updateFilters, clear: clearFilters, page, setPage } = useTransactionFilters();
  const selectedAccountId = urlFilters.accountId ?? null;
  const searchQuery = urlFilters.search ?? "";
  const filterType = urlFilters.type ?? "";
  const filterCategoryId = urlFilters.categoryId ?? "";
  const filterFrom = urlFilters.from ?? "";
  const filterTo = urlFilters.to ?? "";
  const filterCleared = urlFilters.cleared ?? "";
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Modo selección: actuar sobre varios movimientos a la vez (categorizar, liquidar, borrar).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // Otra página, otros filtros u otro orden = otra lista: la selección no se arrastra.
  useEffect(() => { setSelectedIds(new Set()); }, [urlFilters, page, sortBy, sortDir]);

  // ─── Diálogos ────────────────────────────────────────────────
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [txInitial, setTxInitial] = useState<Partial<TxForm> | undefined>(undefined);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [editingRecurringId, setEditingRecurringId] = useState<number | null>(null);
  const [recurringForm, setRecurringForm] = useState<RecurringForm>(() => emptyRecurringForm(today, null));
  const [deleteTxTarget, setDeleteTxTarget] = useState<Transaction | null>(null);
  const [deleteRecurringTarget, setDeleteRecurringTarget] = useState<RecurringTransaction | null>(null);

  const filters: TransactionFilters = useMemo(
    () => ({ ...urlFilters, sortBy, sortDir, page, limit: PAGE_SIZE }),
    [urlFilters, sortBy, sortDir, page],
  );

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: categoryGroups = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const { data: recurringRules = [] } = useQuery({
    queryKey: ["recurring-transactions"],
    queryFn: getRecurringTransactions,
  });
  const { data: txData, isLoading, isFetching, error } = useQuery({
    queryKey: ["transactions", filters],
    queryFn: () => getTransactions(filters),
    placeholderData: (prev) => prev,
  });
  // Las cifras salen del servidor con los mismos filtros que la lista: siempre cuadran con lo que se ve.
  const summary = txData?.summary;

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const selectedAccount = useMemo(
    () => activeAccounts.find((a) => a.id === selectedAccountId) ?? null,
    [activeAccounts, selectedAccountId],
  );
  const canCreateTransfers = activeAccounts.length > 1;

  // ─── Mutaciones ──────────────────────────────────────────────
  const invalidateTx = () => invalidateFinance(queryClient);

  const closeTxDialog = () => setTxDialogOpen(false);

  const closeRecurringDialog = () => {
    setRecurringDialogOpen(false);
    setEditingRecurringId(null);
    setRecurringForm(emptyRecurringForm(today, selectedAccountId));
  };

  const deleteMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => { invalidateTx(); toast.success("Transacción eliminada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const batchMut = useMutation({
    mutationFn: batchTransactions,
    onSuccess: (res, vars) => {
      invalidateTx();
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      const n = res.updated;
      const noun = n === 1 ? "movimiento" : "movimientos";
      const done =
        vars.action === "delete" ? (n === 1 ? "eliminado" : "eliminados")
        : vars.action === "set-category" ? (vars.categoryId === null ? "sin categoría" : n === 1 ? "categorizado" : "categorizados")
        : vars.cleared ? (n === 1 ? "liquidado" : "liquidados") : (n === 1 ? "pasado a pendiente" : "pasados a pendiente");
      toast.success(`${n} ${noun} ${done}`);
      if (res.skipped > 0) {
        toast.info(`${res.skipped} ${res.skipped === 1 ? "omitido" : "omitidos"}: traspasos o pagos recurrentes que esa acción no admite`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMut = useMutation({
    mutationFn: toggleCleared,
    onSuccess: () => {
      invalidateTx();
      queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalidateRecurring = () => {
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] });
  };

  const createRecurringMut = useMutation({
    mutationFn: createRecurringTransaction,
    onSuccess: () => { invalidateRecurring(); closeRecurringDialog(); toast.success("Pago recurrente programado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRecurringMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateRecurringTransaction>[1] }) => updateRecurringTransaction(id, data),
    onSuccess: () => { invalidateRecurring(); closeRecurringDialog(); toast.success("Pago recurrente actualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRecurringActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setRecurringTransactionActive(id, active),
    onSuccess: (_, v) => { invalidateRecurring(); toast.success(v.active ? "Pago recurrente reactivado" : "Pago recurrente pausado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRecurringMut = useMutation({
    mutationFn: deleteRecurringTransaction,
    onSuccess: () => { invalidateRecurring(); toast.success("Pago recurrente eliminado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Alta rápida de categoría desde el menú "⋯" (el formulario de transacción tiene la suya).
  const quickCategory = useQuickCategory(categoryGroups, (category) => {
    if (recurringDialogOpen) setRecurringForm((f) => ({ ...f, categoryId: category.id }));
  });

  // ─── Acciones ────────────────────────────────────────────────
  const openCreateForm = (type: TxType = "expense") => {
    setEditingTransaction(null);
    setTxInitial({ type });
    setTxDialogOpen(true);
  };

  // Misma transacción con la fecha de hoy y sin liquidar a ciegas: útil para gastos que se repiten sin ser periódicos.
  const openDuplicateForm = (tx: Transaction) => {
    if (tx.type === "transfer") return;
    setEditingTransaction(null);
    setTxInitial({
      type: tx.type,
      accountId: tx.accountId,
      categoryId: tx.categoryId ?? "",
      amount: tx.amount.toFixed(2),
      payee: tx.payee ?? "",
      memo: tx.memo ?? "",
    });
    setTxDialogOpen(true);
  };

  // El buscador ⌘K enlaza aquí con ?buscar=<texto>: de un solo uso, se
  // consume y se quita de la URL para que un refresco no lo repita. (La
  // acción "Nueva transacción" ya no pasa por aquí: la gestiona el shell.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.has("buscar")) {
      params.delete("buscar");
      changed = true;
    }
    if (!changed) return;
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEditForm = (tx: Transaction) => {
    if (tx.type === "transfer" && tx.transferDirection === "inflow") {
      toast.info("Edita la transferencia desde el movimiento de salida");
      return;
    }
    setEditingTransaction(tx);
    setTxInitial(undefined);
    setTxDialogOpen(true);
  };

  const openCreateRecurring = () => {
    setTab("recurring");
    setEditingRecurringId(null);
    setRecurringForm(emptyRecurringForm(today, selectedAccountId));
    setRecurringDialogOpen(true);
  };

  const openEditRecurring = (rule: RecurringTransaction) => {
    setEditingRecurringId(rule.id);
    setRecurringForm({
      type: rule.type,
      accountId: rule.accountId,
      categoryId: rule.categoryId ?? "",
      amount: rule.amount.toFixed(2),
      cadence: rule.cadence,
      intervalCount: rule.intervalCount,
      startDate: rule.startDate,
      endDate: rule.endDate ?? "",
      payee: rule.payee ?? "",
      memo: rule.memo ?? "",
    });
    setRecurringDialogOpen(true);
  };

  const openRecurringFromTransaction = (tx: Transaction) => {
    if (tx.type === "transfer" || tx.recurringTransactionId) return;
    setEditingRecurringId(null);
    setRecurringForm({
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
    });
    setRecurringDialogOpen(true);
  };

  const handleRecurringSubmit = () => {
    const accountId = recurringForm.accountId || selectedAccountId;
    if (!accountId || !recurringForm.amount) {
      toast.error("Selecciona una cuenta e importe");
      return;
    }
    const payload = {
      accountId: Number(accountId),
      categoryId: recurringForm.categoryId ? Number(recurringForm.categoryId) : null,
      type: recurringForm.type,
      amount: Number(recurringForm.amount),
      cadence: recurringForm.cadence,
      intervalCount: recurringForm.intervalCount,
      startDate: recurringForm.startDate,
      endDate: recurringForm.endDate || null,
      payee: recurringForm.payee || null,
      memo: recurringForm.memo || null,
    };
    if (editingRecurringId) updateRecurringMut.mutate({ id: editingRecurringId, data: payload });
    else createRecurringMut.mutate(payload);
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir(field === "date" ? "desc" : "asc"); }
    setPage(1);
  };

  const handleExport = () => exportTransactions(urlFilters);

  const activeFilterCount = [
    filterType, filterCategoryId, urlFilters.groupId, filterFrom || filterTo, filterCleared, searchQuery,
    urlFilters.uncategorized, urlFilters.minAmount !== undefined || urlFilters.maxAmount !== undefined,
  ].filter(Boolean).length;
  const transactions = txData?.data ?? [];
  const totalCount = txData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleRecurringRules = useMemo(
    () => recurringRules.filter((rule) => !selectedAccountId || rule.accountId === selectedAccountId),
    [recurringRules, selectedAccountId],
  );
  const recurringStats = useMemo(() => {
    const active = visibleRecurringRules.filter((r) => r.active);
    return {
      active: active.length,
      paused: visibleRecurringRules.length - active.length,
      monthlyOut: active.filter((r) => r.type === "expense").reduce((s, r) => s + monthlyEquivalent(r), 0),
      monthlyIn: active.filter((r) => r.type === "income").reduce((s, r) => s + monthlyEquivalent(r), 0),
      pending: visibleRecurringRules.reduce((s, r) => s + r.pendingCount, 0),
    };
  }, [visibleRecurringRules]);

  if ((isLoading && !txData) || loadingAccounts) {
    return (
      <div>
        <PageHeaderSkeleton />
        <div className="mb-6 flex gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-40 rounded-xl" />)}</div>
        <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
        <Skeleton className="mt-6 h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !txData) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudieron cargar las transacciones" description="Revisa tu conexión y vuelve a intentarlo.">
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["transactions"] })}>Reintentar</Button>
      </EmptyState>
    );
  }

  const totalBalance = activeAccounts.reduce((s, a) => s + a.balance, 0);

  return (
    <div>
      <PageHeader
        title="Transacciones"
        description="Todos tus movimientos: filtra, revisa y marca como liquidados. Los pagos recurrentes se programan aquí."
        actions={
          <>
            <Button variant="outline" onClick={handleExport} className="gap-1.5" title="Exportar a CSV con los filtros actuales">
              <Download className="size-4" /> <span className="hidden sm:inline">Exportar</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Más acciones" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onClick={() => openCreateForm("transfer")} disabled={!canCreateTransfers} className="gap-2">
                  <ArrowLeftRight className="size-4" /> Mover entre cuentas
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openCreateRecurring} className="gap-2">
                  <Repeat className="size-4" /> Programar recurrente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={quickCategory.openDialog} className="gap-2">
                  <Tag className="size-4" /> Nueva categoría
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openCreateForm("expense")} className="gap-1.5">
              <Plus className="size-4" /> Nueva transacción
            </Button>
          </>
        }
      />

      {/* Cuentas */}
      {activeAccounts.length > 0 && (
        <div className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div role="radiogroup" aria-label="Filtrar por cuenta" className="flex w-max gap-2">
            {[{ id: null as number | null, name: "Todas las cuentas", balance: totalBalance, color: null as string | null }, ...activeAccounts]
              .map((a) => {
                const selected = selectedAccountId === a.id;
                return (
                  <button
                    key={a.id ?? "all"}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => updateFilters({ accountId: a.id ?? undefined })}
                    className={cn(
                      "flex min-w-36 cursor-pointer flex-col items-start rounded-xl border px-3.5 py-2.5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50",
                      selected
                        ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/25"
                        : "border-border bg-card/60 hover:bg-card",
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {a.color
                        ? <span className={cn("size-2 rounded-full", darkBoost(a.color))} style={{ backgroundColor: a.color }} aria-hidden="true" />
                        : <Wallet className="size-3" aria-hidden="true" />}
                      {a.name}
                    </span>
                    <span className={cn("mt-0.5 text-sm font-semibold tabular-nums", a.balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                      {formatCurrency(a.balance)}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between gap-3">
        <Segmented
          aria-label="Vista"
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: "movements", label: `Movimientos${totalCount ? ` · ${totalCount}` : ""}`, icon: Receipt },
            { value: "recurring", label: `Recurrentes${visibleRecurringRules.length ? ` · ${visibleRecurringRules.length}` : ""}`, icon: Repeat },
          ]}
        />
        {tab === "recurring" && visibleRecurringRules.length > 0 && (
          <Button variant="outline" onClick={openCreateRecurring} className="gap-1.5">
            <Plus className="size-4" /> Programar
          </Button>
        )}
      </div>

      {tab === "movements" ? (
        <>
          <StatGrid className="grid-cols-2">
            <StatCard label="Ingresos" value={summary ? formatCurrency(summary.income) : "—"} icon={TrendingUp} hint={activeFilterCount ? "Con los filtros actuales" : "Todo el histórico"} />
            <StatCard label="Gastos" value={summary ? formatCurrency(summary.expense) : "—"} icon={TrendingDown} hint={selectedAccount ? selectedAccount.name : "Todas las cuentas"} />
            <StatCard
              label="Balance"
              value={summary ? <span className={summary.net < 0 ? "text-red-600 dark:text-red-400" : undefined}>{summary.net > 0 ? "+" : ""}{formatCurrency(summary.net)}</span> : "—"}
              icon={Scale}
              hint={summary && summary.income > 0 ? `Ahorras el ${Math.round((summary.net / summary.income) * 100)} % de lo que ingresas` : "Ingresos menos gastos"}
            />
            <StatCard
              label="Por liquidar"
              value={filterCleared === "true" ? 0 : summary?.pending ?? "—"}
              icon={ListChecks}
              hint={activeFilterCount ? `De ${totalCount} con los filtros actuales` : `De ${totalCount} movimientos`}
            />
          </StatGrid>

          <div className="mt-6 overflow-clip rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
            {/* Aviso: movimientos sin categoría (no cuentan en el presupuesto) */}
            {summary && summary.uncategorizedExpenses > 0 && !urlFilters.uncategorized && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-amber-500/5 px-4 py-2.5 text-sm">
                <p className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                  <Tag className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="tabular-nums">{summary.uncategorizedExpenses}</strong>{" "}
                    {summary.uncategorizedExpenses === 1 ? "gasto sin categoría" : "gastos sin categoría"}: sin ella no cuentan en tu presupuesto.
                  </span>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { updateFilters({ uncategorized: true, type: "expense", categoryId: undefined, groupId: undefined }); setSelectionMode(true); }}
                >
                  Revisar
                </Button>
              </div>
            )}

            {/* Barra de filtros */}
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => updateFilters({ search: e.target.value || undefined })}
                    placeholder="Buscar por beneficiario o nota"
                    aria-label="Buscar transacciones"
                    className="pl-8"
                  />
                </div>
                <Segmented
                  aria-label="Tipo de movimiento"
                  value={filterType || "all"}
                  onChange={(v) => updateFilters({ type: v === "all" ? undefined : v })}
                  options={[
                    { value: "all", label: "Todos" },
                    { value: "expense", label: "Gastos" },
                    { value: "income", label: "Ingresos" },
                    { value: "transfer", label: "Traspasos" },
                  ]}
                  className="self-start overflow-x-auto lg:self-auto"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <CategorySelect
                  value={filterCategoryId}
                  onChange={(v) => updateFilters({ categoryId: v === "" ? undefined : Number(v), groupId: undefined, uncategorized: undefined })}
                  groups={categoryGroups}
                  noneLabel="Todas las categorías"
                  className="col-span-2 sm:w-56"
                />
                <Select value={filterCleared || NONE} onValueChange={(v) => updateFilters({ cleared: !v || v === NONE ? undefined : (v as "true" | "false") })}>
                  <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por estado">
                    <SelectValue>{(v: string) => CLEARED_LABELS[v] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquier estado</SelectItem>
                    <SelectItem value="true">Liquidadas</SelectItem>
                    <SelectItem value="false">Pendientes</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={`${sortBy}:${sortDir}`}
                  onValueChange={(v) => {
                    const opt = SORT_OPTIONS.find((o) => o.value === v);
                    if (opt) { setSortBy(opt.field); setSortDir(opt.dir); setPage(1); }
                  }}
                >
                  <SelectTrigger className="w-full sm:w-44" aria-label="Ordenar">
                    <SelectValue>{(v: string) => SORT_OPTIONS.find((o) => o.value === v)?.label ?? "Ordenar"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="col-span-2 flex items-center gap-1.5 rounded-lg border border-input px-2 sm:col-span-1">
                  <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <input
                    type="date"
                    value={filterFrom}
                    onChange={(e) => updateFilters({ from: e.target.value || undefined })}
                    aria-label="Desde"
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none sm:w-32 sm:flex-none"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="date"
                    value={filterTo}
                    onChange={(e) => updateFilters({ to: e.target.value || undefined })}
                    aria-label="Hasta"
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none sm:w-32 sm:flex-none"
                  />
                </div>
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="col-span-2 justify-self-start gap-1 text-muted-foreground sm:col-span-1">
                    <X className="size-3.5" /> Limpiar filtros ({activeFilterCount})
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => {
                  const active = activePeriod(filterFrom, filterTo) === key;
                  return (
                    <FilterChip
                      key={key}
                      active={active}
                      onClick={() => updateFilters(active ? { from: undefined, to: undefined } : periodRange(key))}
                    >
                      {PERIOD_LABELS[key]}
                    </FilterChip>
                  );
                })}
                <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <FilterChip
                  active={!!urlFilters.uncategorized}
                  count={summary?.uncategorizedExpenses}
                  onClick={() => updateFilters(urlFilters.uncategorized
                    ? { uncategorized: undefined }
                    : { uncategorized: true, type: "expense", categoryId: undefined, groupId: undefined })}
                >
                  <Tag className="size-3" aria-hidden="true" /> Sin categoría
                </FilterChip>
                {urlFilters.groupId && (
                  <FilterChip active onClick={() => updateFilters({ groupId: undefined })}>
                    Grupo: {categoryGroups.find((g) => g.id === urlFilters.groupId)?.name ?? "—"}
                    <X className="size-3" aria-hidden="true" />
                  </FilterChip>
                )}
                <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <AmountRangeFilter min={urlFilters.minAmount} max={urlFilters.maxAmount} onChange={updateFilters} />
                <Button
                  variant={selectionMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setSelectionMode((m) => !m); setSelectedIds(new Set()); }}
                  aria-pressed={selectionMode}
                  className="ml-auto gap-1.5"
                >
                  <ListChecks className="size-4" aria-hidden="true" /> {selectionMode ? "Salir de la selección" : "Seleccionar"}
                </Button>
              </div>
            </div>

            {/* Tabla */}
            <div className={cn("transition-opacity", isFetching && txData && "opacity-60")}>
              {transactions.length === 0 ? (
                urlFilters.uncategorized && summary?.uncategorizedExpenses === 0 ? (
                  <EmptyState compact icon={ListChecks} title="Todo en orden" description="No te queda ningún gasto sin categoría.">
                    <Button variant="outline" size="sm" onClick={clearFilters}>Ver todos los movimientos</Button>
                  </EmptyState>
                ) : activeFilterCount > 0 ? (
                  <EmptyState compact icon={Search} title="Sin resultados" description="Ningún movimiento coincide con los filtros actuales.">
                    <Button variant="outline" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
                  </EmptyState>
                ) : (
                  <EmptyState
                    compact
                    icon={Receipt}
                    title={selectedAccount ? `Sin movimientos en ${selectedAccount.name}` : "Aún no hay transacciones"}
                    description="Añade tu primera transacción o importa tus datos desde YNAB."
                  >
                    <Button onClick={() => openCreateForm("expense")} className="gap-1.5"><Plus className="size-4" /> Nueva transacción</Button>
                    <a href="/app/import" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
                      <Download className="size-4" /> Importar
                    </a>
                  </EmptyState>
                )
              ) : (
                <TransactionTable
                  transactions={transactions}
                  accountsById={accountsById}
                  showAccount={!selectedAccountId}
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  today={today}
                  onEdit={openEditForm}
                  onToggleCleared={(tx) => clearMut.mutate(tx.id)}
                  onSchedule={openRecurringFromTransaction}
                  onDuplicate={openDuplicateForm}
                  selection={selectionMode ? {
                    ids: selectedIds,
                    onToggle: (id) => setSelectedIds((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
                    onToggleAll: (ids, select) => setSelectedIds((cur) => { const next = new Set(cur); for (const id of ids) { if (select) next.add(id); else next.delete(id); } return next; }),
                  } : undefined}
                  onDelete={setDeleteTxTarget}
                />
              )}
            </div>

            {/* Paginación */}
            {totalCount > 0 && (
              <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalCount)} de {totalCount}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Página anterior">
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="px-1 tabular-nums">Página {page} de {totalPages}</span>
                    <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="Página siguiente">
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <StatGrid className="grid-cols-2">
            <StatCard label="Reglas activas" value={recurringStats.active} icon={Repeat} hint={recurringStats.paused ? `${recurringStats.paused} en pausa` : "Ninguna en pausa"} />
            <StatCard label="Gastos fijos al mes" value={formatCurrency(recurringStats.monthlyOut)} icon={TrendingDown} hint="Equivalente mensual" />
            <StatCard label="Ingresos fijos al mes" value={formatCurrency(recurringStats.monthlyIn)} icon={PiggyBank} hint="Equivalente mensual" />
            <StatCard label="Pendientes" value={recurringStats.pending} icon={ListChecks} hint="Instancias sin liquidar" />
          </StatGrid>

          <SectionCard
            className="mt-6"
            title="Pagos recurrentes"
            description="Las instancias se crean como pendientes y no afectan al saldo hasta que las marques como liquidadas."
          >
            {visibleRecurringRules.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleRecurringRules.map((rule) => (
                  <RecurringRuleCard
                    key={rule.id}
                    rule={rule}
                    onEdit={() => openEditRecurring(rule)}
                    onToggleActive={() => toggleRecurringActiveMut.mutate({ id: rule.id, active: !rule.active })}
                    onDelete={() => setDeleteRecurringTarget(rule)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                icon={Repeat}
                title={selectedAccount ? `No hay pagos recurrentes en ${selectedAccount.name}` : "Sin pagos recurrentes"}
                description="Programa el alquiler, la nómina o tus suscripciones para no tener que apuntarlos cada mes. También puedes partir de una transacción existente desde su menú."
              >
                <Button onClick={openCreateRecurring} className="gap-1.5"><Plus className="size-4" /> Programar recurrente</Button>
              </EmptyState>
            )}
          </SectionCard>
        </>
      )}

      <TransactionFormDialog
        open={txDialogOpen}
        onClose={closeTxDialog}
        editing={editingTransaction}
        initial={txInitial}
        defaultAccountId={selectedAccountId}
      />

      <RecurringDialog
        open={recurringDialogOpen}
        editing={!!editingRecurringId}
        form={recurringForm}
        setForm={setRecurringForm}
        accounts={activeAccounts}
        groups={categoryGroups}
        pending={createRecurringMut.isPending || updateRecurringMut.isPending}
        onClose={closeRecurringDialog}
        onSubmit={handleRecurringSubmit}
      />

      {quickCategory.dialog}

      {selectionMode && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          groups={categoryGroups}
          busy={batchMut.isPending}
          onCategorize={(categoryId) => batchMut.mutate({ action: "set-category", ids: [...selectedIds], categoryId })}
          onSetCleared={(cleared) => batchMut.mutate({ action: "set-cleared", ids: [...selectedIds], cleared })}
          onDelete={() => setBulkDeleteOpen(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      <ConfirmModal
        open={bulkDeleteOpen}
        title="Eliminar movimientos"
        message={`¿Eliminar ${selectedIds.size} ${selectedIds.size === 1 ? "movimiento" : "movimientos"}? Los pagos recurrentes se omiten (se gestionan desde su programación) y de un traspaso se borran las dos partes. No se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => batchMut.mutate({ action: "delete", ids: [...selectedIds] })}
        onCancel={() => setBulkDeleteOpen(false)}
      />
      <ConfirmModal
        open={!!deleteTxTarget}
        title="Eliminar transacción"
        message="¿Eliminar esta transacción? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (deleteTxTarget) deleteMut.mutate(deleteTxTarget.id); setDeleteTxTarget(null); }}
        onCancel={() => setDeleteTxTarget(null)}
      />
      <ConfirmModal
        open={!!deleteRecurringTarget}
        title="Eliminar programación recurrente"
        message={`¿Eliminar la programación recurrente de ${deleteRecurringTarget?.payee || "este movimiento"}?`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (deleteRecurringTarget) deleteRecurringMut.mutate(deleteRecurringTarget.id); setDeleteRecurringTarget(null); }}
        onCancel={() => setDeleteRecurringTarget(null)}
      />
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Providers>
      <TransactionsView />
    </Providers>
  );
}
