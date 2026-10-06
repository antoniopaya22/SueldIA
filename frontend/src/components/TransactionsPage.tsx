import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, Plus, Search, ArrowLeftRight, Repeat, Download, ChevronLeft, ChevronRight,
  MoreHorizontal, Tag, TrendingUp, TrendingDown, Scale, ListChecks, X, CalendarRange,
  AlertTriangle, PiggyBank, Wallet,
} from "lucide-react";
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  deleteTransaction,
  exportTransactions,
  getAccounts,
  getCategories,
  getFinanceAnalytics,
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
  CategorySelect, NONE, getNextMonthlyOccurrence, getTodayIsoDate, type TxType,
} from "./finance-manage/transactions/shared";
import type { TxForm } from "./finance-manage/transactions/TransactionDialog";
import { TransactionFormDialog } from "./finance-manage/transactions/TransactionFormDialog";
import { useQuickCategory } from "./finance-manage/transactions/useQuickCategory";
import { RecurringDialog, type RecurringForm } from "./finance-manage/transactions/RecurringDialog";
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
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  // El buscador ⌘K enlaza aquí con ?buscar=<texto> (ver app/CommandMenu.tsx).
  const [searchQuery, setSearchQuery] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("buscar") ?? "",
  );
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterType, setFilterType] = useState<"" | TxType>("");
  const [filterCategoryId, setFilterCategoryId] = useState<number | "">("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCleared, setFilterCleared] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);

  // ─── Diálogos ────────────────────────────────────────────────
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [txInitial, setTxInitial] = useState<Partial<TxForm> | undefined>(undefined);
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false);
  const [editingRecurringId, setEditingRecurringId] = useState<number | null>(null);
  const [recurringForm, setRecurringForm] = useState<RecurringForm>(() => emptyRecurringForm(today, null));
  const [deleteTxTarget, setDeleteTxTarget] = useState<Transaction | null>(null);
  const [deleteRecurringTarget, setDeleteRecurringTarget] = useState<RecurringTransaction | null>(null);

  const filters: TransactionFilters = useMemo(() => ({
    accountId: selectedAccountId ?? undefined,
    search: searchQuery || undefined,
    type: filterType || undefined,
    categoryId: filterCategoryId ? Number(filterCategoryId) : undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    cleared: filterCleared || undefined,
    sortBy,
    sortDir,
    page,
    limit: PAGE_SIZE,
  }), [selectedAccountId, searchQuery, filterType, filterCategoryId, filterFrom, filterTo, filterCleared, sortBy, sortDir, page]);

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
  // Totales del periodo (la API de analítica admite fechas, cuenta y categoría).
  const summaryFilters = useMemo(() => ({
    from: filterFrom || undefined,
    to: filterTo || undefined,
    accountId: selectedAccountId ?? undefined,
    categoryId: filterCategoryId ? Number(filterCategoryId) : undefined,
  }), [filterFrom, filterTo, selectedAccountId, filterCategoryId]);
  // Pendientes de liquidar con los mismos filtros (solo interesa el total).
  const pendingFilters = useMemo(() => ({ ...filters, cleared: "false" as const, page: 1, limit: 1 }), [filters]);
  const { data: pendingData } = useQuery({
    queryKey: ["transactions", pendingFilters],
    queryFn: () => getTransactions(pendingFilters),
    enabled: filterCleared !== "true",
  });
  const { data: summaryData } = useQuery({
    queryKey: ["finance-analytics", "transactions-summary", summaryFilters],
    queryFn: () => getFinanceAnalytics(summaryFilters),
  });

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

  const clearFilters = () => {
    setFilterType("");
    setFilterCategoryId("");
    setFilterFrom("");
    setFilterTo("");
    setFilterCleared("");
    setSearchQuery("");
    setPage(1);
  };

  const handleExport = () => exportTransactions({
    accountId: selectedAccountId ?? undefined,
    search: searchQuery || undefined,
    type: filterType || undefined,
    categoryId: filterCategoryId ? Number(filterCategoryId) : undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    cleared: filterCleared || undefined,
  });

  const activeFilterCount = [filterType, filterCategoryId, filterFrom || filterTo, filterCleared, searchQuery].filter(Boolean).length;
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

  const summary = summaryData?.summary;
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
                    onClick={() => { setSelectedAccountId(a.id); setPage(1); }}
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
            <StatCard label="Ingresos" value={summary ? formatCurrency(summary.incomeTotal) : "—"} icon={TrendingUp} hint={filterFrom || filterTo ? "En el periodo filtrado" : "Todo el histórico"} />
            <StatCard label="Gastos" value={summary ? formatCurrency(summary.expenseTotal) : "—"} icon={TrendingDown} hint={selectedAccount ? selectedAccount.name : "Todas las cuentas"} />
            <StatCard
              label="Balance"
              value={summary ? <span className={summary.netTotal < 0 ? "text-red-600 dark:text-red-400" : undefined}>{summary.netTotal > 0 ? "+" : ""}{formatCurrency(summary.netTotal)}</span> : "—"}
              icon={Scale}
              hint={summary && summary.incomeTotal > 0 ? `Ahorras el ${Math.round(summary.savingsRate)} % de lo que ingresas` : "Ingresos menos gastos"}
            />
            <StatCard
              label="Por liquidar"
              value={filterCleared === "true" ? 0 : pendingData?.total ?? "—"}
              icon={ListChecks}
              hint={activeFilterCount ? `De ${totalCount} con los filtros actuales` : `De ${totalCount} movimientos`}
            />
          </StatGrid>

          <div className="mt-6 overflow-clip rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
            {/* Barra de filtros */}
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                    placeholder="Buscar por beneficiario o nota"
                    aria-label="Buscar transacciones"
                    className="pl-8"
                  />
                </div>
                <Segmented
                  aria-label="Tipo de movimiento"
                  value={filterType || "all"}
                  onChange={(v) => { setFilterType(v === "all" ? "" : v); setPage(1); }}
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
                  onChange={(v) => { setFilterCategoryId(v); setPage(1); }}
                  groups={categoryGroups}
                  noneLabel="Todas las categorías"
                  className="col-span-2 sm:w-56"
                />
                <Select value={filterCleared || NONE} onValueChange={(v) => { setFilterCleared(!v || v === NONE ? "" : (v as "true" | "false")); setPage(1); }}>
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
                    onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                    aria-label="Desde"
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none sm:w-32 sm:flex-none"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <input
                    type="date"
                    value={filterTo}
                    onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
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
            </div>

            {/* Tabla */}
            <div className={cn("transition-opacity", isFetching && txData && "opacity-60")}>
              {transactions.length === 0 ? (
                activeFilterCount > 0 ? (
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
