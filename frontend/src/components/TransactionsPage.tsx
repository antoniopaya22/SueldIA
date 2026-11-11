import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Receipt, Plus, Search, ArrowLeftRight, Repeat, Download, ChevronLeft, ChevronRight,
  MoreHorizontal, Tag, TrendingUp, TrendingDown, Scale, ListChecks, X, CalendarRange,
  AlertTriangle, PiggyBank, Wallet, SlidersHorizontal, CheckCheck, Clock, ArrowUpDown, FileSpreadsheet, FileText,
} from "lucide-react";
import {
  applyCategorySuggestions,
  batchTransactions,
  createCategoryRule,
  deleteTransaction,
  exportTransactions,
  getAccounts,
  getCategories,
  getRecurringTransactions,
  getSubscriptionSuggestions,
  getTransactions,
  setCleared,
  splitTransaction,
  unsplitTransaction,
  updateTransaction,
  type Transaction,
  type TransactionFilters,
  skipRecurringOccurrence,
} from "../lib/api";
import { Providers } from "./Providers";
import { toast } from "sonner";
import { formatCurrency, plural } from "../lib/format";
import { invalidateFinance } from "../lib/finance-cache";
import { deferWithUndo, groupIdsBy } from "../lib/undo";
import { setUrlParams, useUrlEnumParam, useUrlParam } from "../lib/url-state";
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
import { CategorySelect, FilterChip, NONE, formatDateShort, getTodayIsoDate, type TxType } from "./finance-manage/transactions/shared";
import type { TxForm } from "./finance-manage/transactions/TransactionDialog";
import { TransactionFormDialog } from "./finance-manage/transactions/TransactionFormDialog";
import { useQuickCategory } from "./finance-manage/transactions/useQuickCategory";
import { monthlyEquivalent, useRecurringEditor } from "./finance-manage/transactions/use-recurring-editor";
import { SettleDialog } from "./finance-manage/transactions/SettleDialog";
import { SplitDialog } from "./finance-manage/transactions/SplitDialog";
import { AmountRangeFilter } from "./finance-manage/transactions/AmountRangeFilter";
import { BulkActionBar } from "./finance-manage/transactions/BulkActionBar";
import { describeApply } from "./categories/CategoryRulesCard";
import { RecurringRuleCard } from "./finance-manage/transactions/RecurringRuleCard";
import { SubscriptionSuggestions } from "./finance-manage/transactions/SubscriptionSuggestions";
import { TransactionTable, type SortDir, type SortField } from "./finance-manage/transactions/TransactionTable";
import { AccountOrderDialog } from "./finance-manage/AccountOrderDialog";
import { cn } from "cn";
import { FLAGS, flagMeta, type FlagValue } from "@/lib/flags";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";

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

const SORT_FIELDS: readonly SortField[] = ["date", "payee", "category", "amount", "type"];

function TransactionsView() {
  const queryClient = useQueryClient();
  const today = getTodayIsoDate();

  // ─── Filtros y vista ─────────────────────────────────────────
  // Pestaña, orden y página en la URL (?vista=recurrentes, ?orden=importe-asc…):
  // un enlace puede llevar directo a Recurrentes y una recarga no los pierde.
  const [vista, setVista] = useUrlEnumParam("vista", ["movimientos", "recurrentes"] as const, "movimientos");
  const tab: "movements" | "recurring" = vista === "recurrentes" ? "recurring" : "movements";
  const setTab = (t: "movements" | "recurring") => setVista(t === "recurring" ? "recurrentes" : "movimientos");
  // Los filtros viven en la URL (?cuenta=…&categoria=…): compartibles, recargables y enlazables desde gráficos.
  const { filters: urlFilters, update: updateFilters, clear: clearFilters, page, setPage } = useTransactionFilters();
  const selectedAccountId = urlFilters.accountId ?? null;
  const searchQuery = urlFilters.search ?? "";
  const filterType = urlFilters.type ?? "";
  const filterCategoryId = urlFilters.categoryId ?? "";
  const filterFrom = urlFilters.from ?? "";
  const filterTo = urlFilters.to ?? "";
  const filterCleared = urlFilters.cleared ?? "";
  const [sortParam] = useUrlParam("orden", "date-desc");
  const [sortByRaw, sortDirRaw] = sortParam.split("-");
  const sortBy: SortField = (SORT_FIELDS as readonly string[]).includes(sortByRaw) ? (sortByRaw as SortField) : "date";
  const sortDir: SortDir = sortDirRaw === "asc" ? "asc" : "desc";
  const setSort = (field: SortField, dir: SortDir) =>
    setUrlParams({ orden: field === "date" && dir === "desc" ? null : `${field}-${dir}`, pagina: null });

  // Búsqueda con retardo: antes cada tecla lanzaba una petición y reescribía la URL.
  const [searchInput, setSearchInput] = useState(searchQuery);
  useEffect(() => setSearchInput(searchQuery), [searchQuery]);
  useEffect(() => {
    if (searchInput === searchQuery) return;
    const t = setTimeout(() => updateFilters({ search: searchInput.trim() || undefined }), 300);
    return () => clearTimeout(t);
  }, [searchInput, searchQuery, updateFilters]);

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
  const [settleTarget, setSettleTarget] = useState<Transaction | null>(null);
  const [splitTarget, setSplitTarget] = useState<Transaction | null>(null);

  const filters: TransactionFilters = useMemo(
    () => ({ ...urlFilters, sortBy, sortDir, page, limit: PAGE_SIZE }),
    [urlFilters, sortBy, sortDir, page],
  );

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: categoryGroups = [] } = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const { data: subscriptionSuggestions = [] } = useQuery({
    queryKey: ["recurring-suggestions"],
    queryFn: getSubscriptionSuggestions,
    enabled: tab === "recurring",
  });
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

  // Quita de la lista (al momento) los movimientos indicados y lo que se borra
  // con ellos: la otra pata de un traspaso y las partes de un gasto dividido.
  const hideTransactions = (ids: number[]) => {
    const rows = txData?.data ?? [];
    const hidden = new Set(ids);
    for (const t of rows) {
      if (!hidden.has(t.id)) continue;
      if (t.transferId) hidden.add(t.transferId);
      if (t.splitGroupId) for (const o of rows) if (o.splitGroupId === t.splitGroupId) hidden.add(o.id);
    }
    queryClient.setQueriesData<Awaited<ReturnType<typeof getTransactions>>>({ queryKey: ["transactions"] }, (old) =>
      old && Array.isArray(old.data) ? { ...old, data: old.data.filter((t) => !hidden.has(t.id)), total: Math.max(0, old.total - (old.data.length - old.data.filter((t) => !hidden.has(t.id)).length)) } : old,
    );
  };

  // Borrar con «Deshacer» en vez de confirmación: desaparece al momento y la
  // petición sale a los pocos segundos si no se deshace.
  const deleteWithUndo = (ids: number[], message: string, commit: () => Promise<unknown>) => {
    hideTransactions(ids);
    setSelectedIds(new Set());
    deferWithUndo({
      message,
      commit,
      onUndo: invalidateTx,
      onCommitted: invalidateTx,
      onError: (e) => { toast.error(e.message); invalidateTx(); },
    });
  };

  // Para deshacer categorizar/liquidar en lote: el valor que tenía cada
  // movimiento antes (la selección es de la página visible, así que está en caché).
  const previousValues = (ids: number[]) => {
    const byId = new Map((txData?.data ?? []).map((t) => [t.id, t]));
    return ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  };

  const undoBatch = async (vars: Parameters<typeof batchTransactions>[0], before: ReturnType<typeof previousValues>) => {
    if (vars.action === "set-category") {
      const groups = groupIdsBy(before.filter((t) => t.type !== "transfer").map((t) => ({ id: t.id, value: t.categoryId })));
      for (const [categoryId, ids] of groups) await batchTransactions({ action: "set-category", ids, categoryId });
    } else if (vars.action === "set-cleared") {
      const groups = groupIdsBy(before.map((t) => ({ id: t.id, value: t.cleared })));
      for (const [cleared, ids] of groups) await batchTransactions({ action: "set-cleared", ids, cleared });
    } else if (vars.action === "set-flag") {
      const groups = groupIdsBy(before.map((t) => ({ id: t.id, value: t.flag ?? null })));
      for (const [flag, ids] of groups) await batchTransactions({ action: "set-flag", ids, flag });
    }
  };

  const batchMut = useMutation({
    mutationFn: (vars: Parameters<typeof batchTransactions>[0]) => {
      const before = previousValues(vars.ids);
      return batchTransactions(vars).then((res) => ({ res, before }));
    },
    onSuccess: ({ res, before }, vars) => {
      invalidateTx();
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      const n = res.updated;
      const noun = n === 1 ? "movimiento" : "movimientos";
      const done =
        vars.action === "delete" ? (n === 1 ? "eliminado" : "eliminados")
        : vars.action === "set-category" ? (vars.categoryId === null ? "sin categoría" : n === 1 ? "categorizado" : "categorizados")
        : vars.action === "set-flag" ? (vars.flag ? (n === 1 ? "marcado" : "marcados") : "sin marca")
        : vars.cleared ? (n === 1 ? "liquidado" : "liquidados") : (n === 1 ? "pasado a pendiente" : "pasados a pendiente");
      toast.success(`${n} ${noun} ${done}`, {
        duration: 8000,
        action: n > 0 && vars.action !== "delete"
          ? {
              label: "Deshacer",
              onClick: () => {
                undoBatch(vars, before).then(
                  () => { invalidateTx(); toast.success("Cambio deshecho"); },
                  (e: Error) => toast.error(e.message),
                );
              },
            }
          : undefined,
      });
      if (res.skipped > 0) {
        toast.info(`${res.skipped} ${res.skipped === 1 ? "omitido" : "omitidos"}: traspasos o pagos recurrentes que esa acción no admite`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // "Sugerir": categoriza la selección con las reglas del usuario y, si no hay regla, con su historial.
  const suggestMut = useMutation({
    mutationFn: (ids: number[]) => applyCategorySuggestions(ids),
    onSuccess: (res) => {
      invalidateTx();
      setSelectedIds(new Set());
      (res.updated > 0 ? toast.success : toast.info)(
        res.updated > 0 && res.skipped > 0
          ? `${describeApply(res)}. ${res.skipped} sin sugerencia: categorízalos a mano o crea una regla.`
          : describeApply(res),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Liquidar un cargo programado con el importe real (recibos variables).
  const settleMut = useMutation({
    mutationFn: ({ id, amount }: { id: number; amount: number }) => updateTransaction(id, { amount, cleared: true }),
    onSuccess: () => {
      invalidateTx();
      setSettleTarget(null);
      toast.success("Movimiento liquidado con el importe real");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const splitMut = useMutation({
    mutationFn: ({ id, parts }: { id: number; parts: Parameters<typeof splitTransaction>[1] }) => splitTransaction(id, parts),
    onSuccess: (res) => {
      invalidateTx();
      setSplitTarget(null);
      toast.success(`Gasto dividido en ${res.ids.length} partes`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsplitMut = useMutation({
    mutationFn: unsplitTransaction,
    onSuccess: () => {
      invalidateTx();
      toast.success("Partes unidas en un solo gasto");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearMut = useMutation({
    mutationFn: ({ id, cleared }: { id: number; cleared: boolean }) => setCleared(id, cleared),
    onSuccess: () => {
      invalidateTx();
      queryClient.invalidateQueries({ queryKey: ["recurring-transactions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recurring = useRecurringEditor({ today, selectedAccountId, accounts: activeAccounts, categoryGroups });

  // Alta rápida de categoría desde el menú "⋯" (el formulario de transacción tiene la suya).
  const quickCategory = useQuickCategory(categoryGroups, (category) => {
    if (recurring.isOpen) recurring.setCategory(category.id);
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

  const openEditForm = (tx: Transaction) => {
    if (tx.type === "transfer" && tx.transferDirection === "inflow") {
      toast.info("Edita el traspaso desde su movimiento de salida");
      return;
    }
    setEditingTransaction(tx);
    setTxInitial(undefined);
    setTxDialogOpen(true);
  };

  const openCreateRecurring = () => {
    setTab("recurring");
    recurring.openCreate();
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSort(field, sortDir === "asc" ? "desc" : "asc");
    else setSort(field, field === "date" ? "desc" : "asc");
  };

  const handleExport = (format: "xlsx" | "csv") =>
    exportTransactions({ ...urlFilters, format }).catch((e: Error) => toast.error(e.message));

  const activeFilterCount = [
    filterType, filterCategoryId, urlFilters.groupId, filterFrom || filterTo, filterCleared, searchQuery,
    urlFilters.uncategorized, urlFilters.minAmount !== undefined || urlFilters.maxAmount !== undefined, urlFilters.flag,
  ].filter(Boolean).length;
  // Filtros que en móvil quedan plegados tras "Filtros" (búsqueda y tipo siempre están a la vista).
  const foldedFilterCount = [
    filterCategoryId, urlFilters.groupId, filterFrom || filterTo, filterCleared, urlFilters.uncategorized,
    urlFilters.minAmount !== undefined || urlFilters.maxAmount !== undefined, urlFilters.flag,
  ].filter(Boolean).length;
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const transactions = txData?.data ?? [];
  // Si todos los seleccionados comparten beneficiario, se ofrece recordarlo como regla.
  const commonPayee = useMemo(() => {
    const payees = new Set(
      transactions.filter((t) => selectedIds.has(t.id)).map((t) => (t.payee ?? "").trim()).filter(Boolean),
    );
    const selectedWithoutPayee = transactions.some((t) => selectedIds.has(t.id) && !(t.payee ?? "").trim());
    return payees.size === 1 && !selectedWithoutPayee ? [...payees][0] : null;
  }, [transactions, selectedIds]);
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
      overdue: visibleRecurringRules.reduce((s, r) => s + r.overdueCount, 0),
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

  const accountKeys = radioGroupKeys([null, ...activeAccounts.map((a) => a.id)], selectedAccountId, (id) => updateFilters({ accountId: id ?? undefined }));

  return (
    <div>
      <PageHeader
        title="Transacciones"
        description="Todos tus movimientos: filtra, revisa y marca como liquidados. Los pagos recurrentes se programan aquí."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5" title="Exportar con los filtros actuales" />}>
                <Download className="size-4" /> <span className="hidden sm:inline">Exportar</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => handleExport("xlsx")} className="gap-2">
                  <FileSpreadsheet className="size-4" /> Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
                  <FileText className="size-4" /> CSV
                </DropdownMenuItem>
                <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Con los filtros que tienes aplicados.</p>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Más acciones" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem onClick={() => openCreateForm("transfer")} disabled={!canCreateTransfers} className="gap-2">
                  <ArrowLeftRight className="size-4" /> Nuevo traspaso
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
          </>
        }
      />

      {/* Cuentas */}
      {activeAccounts.length > 0 && (
        <div className="-mx-4 mb-6 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2">
          <div role="radiogroup" aria-label="Filtrar por cuenta" className="flex gap-2">
            {[{ id: null as number | null, name: "Todas las cuentas", balance: totalBalance, color: null as string | null }, ...activeAccounts]
              .map((a) => {
                const selected = selectedAccountId === a.id;
                return (
                  <button
                    key={a.id ?? "all"}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={accountKeys.tabIndex(a.id)}
                    onKeyDown={accountKeys.onKeyDown}
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
            {activeAccounts.length > 1 && (
              <button
                type="button"
                onClick={() => setOrderOpen(true)}
                className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                title="Cambiar el orden de las cuentas"
              >
                <ArrowUpDown className="size-4" aria-hidden="true" />
                Ordenar
              </button>
            )}
          </div>
        </div>
      )}
      <AccountOrderDialog open={orderOpen} onClose={() => setOrderOpen(false)} accounts={accounts} />

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
          {selectedAccount ? (
            // Con una cuenta elegida: sus saldos al estilo YNAB (liquidado + sin liquidar = saldo de trabajo).
            <StatGrid className="sm:grid-cols-3 xl:grid-cols-3">
              <StatCard
                label="Saldo liquidado"
                value={<span className={selectedAccount.balance < 0 ? "text-red-600 dark:text-red-400" : undefined}>{formatCurrency(selectedAccount.balance)}</span>}
                icon={CheckCheck}
                hint="Lo que ya refleja el banco"
              />
              <StatCard
                label="Pendiente"
                value={
                  <span className={selectedAccount.unclearedBalance < 0 ? "text-red-600 dark:text-red-400" : undefined}>
                    {selectedAccount.unclearedBalance > 0 ? "+" : ""}{formatCurrency(selectedAccount.unclearedBalance)}
                  </span>
                }
                icon={Clock}
                hint={selectedAccount.unclearedCount === 0
                  ? "Todo liquidado"
                  : `${selectedAccount.unclearedCount} ${selectedAccount.unclearedCount === 1 ? "movimiento pendiente" : "movimientos pendientes"}`}
              />
              <StatCard
                label="Saldo de trabajo"
                value={<span className={selectedAccount.workingBalance < 0 ? "text-red-600 dark:text-red-400" : undefined}>{formatCurrency(selectedAccount.workingBalance)}</span>}
                icon={Wallet}
                hint="Liquidado + sin liquidar"
                emphasis
              />
            </StatGrid>
          ) : (
          <StatGrid className="grid-cols-2">
            <StatCard label="Ingresos" value={summary ? formatCurrency(summary.income) : "—"} icon={TrendingUp} hint={activeFilterCount ? "Con los filtros actuales" : "Todo el histórico"} />
            <StatCard label="Gastos" value={summary ? formatCurrency(summary.expense) : "—"} icon={TrendingDown} hint="Todas las cuentas" />
            <StatCard
              label="Balance"
              value={summary ? <span className={summary.net < 0 ? "text-red-600 dark:text-red-400" : undefined}>{summary.net > 0 ? "+" : ""}{formatCurrency(summary.net)}</span> : "—"}
              icon={Scale}
              hint={summary && summary.income > 0 ? `Ahorras el ${Math.round((summary.net / summary.income) * 100)} % de lo que ingresas` : "Ingresos menos gastos"}
            />
            <StatCard
              label="Pendientes"
              value={filterCleared === "true" ? 0 : summary?.pending ?? "—"}
              icon={ListChecks}
              hint={activeFilterCount ? `De ${totalCount} con los filtros actuales` : `De ${plural(totalCount, "movimiento", "movimientos")}`}
            />
          </StatGrid>
          )}

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
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
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
              {/* Móvil: el resto de filtros, plegado; la selección múltiple, siempre a mano. */}
              <div className="flex items-center gap-2 sm:hidden">
                <Button
                  variant={mobileFiltersOpen ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setMobileFiltersOpen((o) => !o)}
                  aria-expanded={mobileFiltersOpen}
                  aria-controls="transaction-filters-more"
                  className="gap-1.5"
                >
                  <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                  Filtros{foldedFilterCount > 0 && <span className="tabular-nums text-muted-foreground">· {foldedFilterCount}</span>}
                </Button>
                <Button
                  variant={selectionMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setSelectionMode((m) => !m); setSelectedIds(new Set()); }}
                  aria-pressed={selectionMode}
                  className="ml-auto gap-1.5"
                >
                  <ListChecks className="size-4" aria-hidden="true" /> {selectionMode ? "Salir" : "Seleccionar"}
                </Button>
              </div>
              <div id="transaction-filters-more" className={cn("flex-col gap-3 sm:flex", mobileFiltersOpen ? "flex" : "hidden")}>
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
                  value={urlFilters.flag ?? NONE}
                  onValueChange={(v) => updateFilters({ flag: !v || v === NONE ? undefined : (v as FlagValue | "any") })}
                >
                  <SelectTrigger className="w-full sm:w-40" aria-label="Filtrar por marca">
                    <SelectValue>
                      {(v: string) => (v === NONE ? "Cualquier marca" : v === "any" ? "Con marca" : (
                        <span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", flagMeta(v)?.dot)} />{flagMeta(v)?.label}</span>
                      ))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Cualquier marca</SelectItem>
                    <SelectItem value="any">Con alguna marca</SelectItem>
                    {FLAGS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        <span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-full", f.dot)} />{f.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={`${sortBy}:${sortDir}`}
                  onValueChange={(v) => {
                    const opt = SORT_OPTIONS.find((o) => o.value === v);
                    if (opt) setSort(opt.field, opt.dir);
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
                  className="ml-auto hidden gap-1.5 sm:inline-flex"
                >
                  <ListChecks className="size-4" aria-hidden="true" /> {selectionMode ? "Salir de la selección" : "Seleccionar"}
                </Button>
              </div>
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
                  onToggleCleared={(tx) => clearMut.mutate({ id: tx.id, cleared: !tx.cleared })}
                  onSchedule={recurring.openFromTransaction}
                  onSkip={(tx) => deleteWithUndo([tx.id], `Saltado: ${tx.payee || "pago recurrente"} del ${formatDateShort(tx.date)}`, () => skipRecurringOccurrence(tx.id))}
                  onDuplicate={openDuplicateForm}
                  onSettle={setSettleTarget}
                  onSplit={setSplitTarget}
                  onUnsplit={(tx) => unsplitMut.mutate(tx.id)}
                  selection={selectionMode ? {
                    ids: selectedIds,
                    onToggle: (id) => setSelectedIds((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
                    onToggleAll: (ids, select) => setSelectedIds((cur) => { const next = new Set(cur); for (const id of ids) { if (select) next.add(id); else next.delete(id); } return next; }),
                  } : undefined}
                  onDelete={(tx) => (tx.reconciled && !window.confirm("Este movimiento está conciliado con el banco: borrarlo descuadrará la conciliación. ¿Borrarlo igualmente?")) ? undefined : deleteWithUndo(
                    [tx.id],
                    tx.splitGroupId ? "Gasto dividido eliminado (todas sus partes)"
                      : tx.type === "transfer" ? "Traspaso eliminado (las dos partes)"
                      : "Movimiento eliminado",
                    () => deleteTransaction(tx.id),
                  )}
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
                    <Button variant="outline" size="icon-sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Página anterior">
                      <ChevronLeft className="size-4" />
                    </Button>
                    <span className="px-1 tabular-nums">Página {page} de {totalPages}</span>
                    <Button variant="outline" size="icon-sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Página siguiente">
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
            <StatCard label="Vencidas" value={recurringStats.overdue} icon={ListChecks} hint={recurringStats.overdue > 0 ? "Ya han llegado a su fecha: por liquidar" : "Nada vencido por liquidar"} />
          </StatGrid>

          <SubscriptionSuggestions suggestions={subscriptionSuggestions} onSchedule={recurring.openFromSuggestion} />

          <SectionCard
            className="mt-6"
            title="Pagos recurrentes"
            description="Las instancias se crean como pendientes y no afectan al saldo hasta que las marques como liquidadas, salvo las de las reglas automáticas, que se liquidan solas el día del cargo."
          >
            {visibleRecurringRules.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleRecurringRules.map((rule) => (
                  <RecurringRuleCard
                    key={rule.id}
                    rule={rule}
                    onEdit={() => recurring.openEdit(rule)}
                    onToggleActive={() => recurring.toggleActive(rule)}
                    onDelete={() => recurring.askDelete(rule)}
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

      {recurring.dialogs}

      {quickCategory.dialog}

      {selectionMode && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          groups={categoryGroups}
          busy={batchMut.isPending || suggestMut.isPending}
          commonPayee={commonPayee}
          onSuggest={() => suggestMut.mutate([...selectedIds])}
          onCategorize={(categoryId, remember) => {
            batchMut.mutate({ action: "set-category", ids: [...selectedIds], categoryId });
            if (remember && categoryId !== null && commonPayee) {
              createCategoryRule({ match: commonPayee, categoryId })
                .then(() => toast.success(`Regla creada: «${commonPayee}» irá a esa categoría`))
                .catch((e: Error) => toast.error(e.message));
            }
          }}
          onSetCleared={(cleared) => batchMut.mutate({ action: "set-cleared", ids: [...selectedIds], cleared })}
          onSetFlag={(flag) => batchMut.mutate({ action: "set-flag", ids: [...selectedIds], flag })}
          onDelete={() => setBulkDeleteOpen(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      <SplitDialog
        transaction={splitTarget}
        groups={categoryGroups}
        pending={splitMut.isPending}
        onClose={() => setSplitTarget(null)}
        onConfirm={(parts) => splitTarget && splitMut.mutate({ id: splitTarget.id, parts })}
      />
      <SettleDialog
        transaction={settleTarget}
        pending={settleMut.isPending}
        onClose={() => setSettleTarget(null)}
        onConfirm={(amount) => settleTarget && settleMut.mutate({ id: settleTarget.id, amount })}
      />
      <ConfirmModal
        open={bulkDeleteOpen}
        title="Eliminar movimientos"
        message={`¿Eliminar ${selectedIds.size} ${selectedIds.size === 1 ? "movimiento" : "movimientos"}? Los pagos recurrentes se omiten (se gestionan desde su programación) y de un traspaso se borran las dos partes. Tendrás unos segundos para deshacerlo.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => {
          const ids = [...selectedIds].filter((id) => !transactions.find((t) => t.id === id)?.recurringTransactionId);
          setBulkDeleteOpen(false);
          if (ids.length === 0) {
            toast.info("Los pagos recurrentes se gestionan desde su programación");
            return;
          }
          deleteWithUndo(ids, `${ids.length} ${ids.length === 1 ? "movimiento eliminado" : "movimientos eliminados"}`, () =>
            batchTransactions({ action: "delete", ids }));
        }}
        onCancel={() => setBulkDeleteOpen(false)}
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
