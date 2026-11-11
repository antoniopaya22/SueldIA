import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, Plus, Pencil, Trash2, CreditCard, Landmark, Banknote, TrendingUp,
  Archive, ArchiveRestore, Download, PiggyBank, AlertTriangle, type LucideIcon,
  Scale, HandCoins, House, CalendarRange,
} from "lucide-react";
import {
  getAccounts, createAccount, updateAccount, deleteAccount, toggleAccountArchive,
  type Account,
} from "../lib/api";
import { Providers } from "./Providers";
import { toast } from "sonner";
import { formatCurrency, formatPct, formatRate, plural } from "../lib/format";
import { EmptyState } from "./ui/EmptyState";
import { ConfirmModal } from "./ui/ConfirmModal";
import {
  PageHeader, StatCard, StatGrid, SectionCard, Segmented,
  PageHeaderSkeleton, StatCardSkeleton, DecimalInput,
} from "./app";
import { ColorSwatches, SWATCH_COLORS } from "./finance-manage/ColorSwatches";
import { RowActions } from "./finance-manage/RowActions";
import { ReconcileDialog } from "./finance-manage/ReconcileDialog";
import { AmortizationDialog, ValuationDialog, hasLoanTerms } from "./finance-manage/LoanDialogs";
import { transactionsHref } from "../lib/transaction-filters";
import { darkBoost } from "../lib/color";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { radioGroupKeys } from "@/hooks/use-radio-group-keys";

type AccountType = Account["type"];

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: LucideIcon }[] = [
  { value: "bank", label: "Banco", icon: Landmark },
  { value: "credit_card", label: "Tarjeta", icon: CreditCard },
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "investment", label: "Inversión", icon: TrendingUp },
  { value: "loan", label: "Préstamo", icon: HandCoins },
  { value: "mortgage", label: "Hipoteca", icon: House },
  { value: "other", label: "Otro", icon: Wallet },
];

const isLoan = (type: string) => type === "loan" || type === "mortgage";

function typeMeta(type: string) {
  return ACCOUNT_TYPES.find((t) => t.value === type) ?? ACCOUNT_TYPES[ACCOUNT_TYPES.length - 1];
}

function amountClass(n: number) {
  return n < 0 ? "text-red-600 dark:text-red-400" : "text-foreground";
}

// ─── Formulario (crear/editar) ──────────────────────────────────
interface FormState {
  name: string;
  type: AccountType;
  color: string;
  initialBalance: string;
  // Préstamo o hipoteca
  loanPrincipal: number | null;
  loanRate: number | null;
  loanYears: number | null;
  loanStartDate: string;
}

const EMPTY_FORM: FormState = {
  name: "", type: "bank", color: SWATCH_COLORS[0], initialBalance: "",
  loanPrincipal: null, loanRate: null, loanYears: null, loanStartDate: "",
};

function AccountDialog({
  open, editing, form, setForm, onClose, onSubmit, pending,
}: {
  open: boolean;
  editing: Account | null;
  form: FormState;
  setForm: (f: FormState) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const TypeIcon = typeMeta(form.type).icon;
  const typeKeys = radioGroupKeys(ACCOUNT_TYPES.map((t) => t.value), form.type, (type) => setForm({ ...form, type }));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
          className="flex flex-col"
        >
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
            <DialogTitle>{editing ? "Editar cuenta" : "Nueva cuenta"}</DialogTitle>
            <DialogDescription>
              {editing ? "Cambia el nombre, el tipo o el color de la cuenta." : "Añade una cuenta bancaria, tarjeta, efectivo, inversión, préstamo o hipoteca."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5">
            {/* Vista previa */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm", darkBoost(form.color))} style={{ backgroundColor: form.color }}>
                <TypeIcon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{form.name.trim() || "Nombre de la cuenta"}</p>
                <p className="text-xs text-muted-foreground">{typeMeta(form.type).label}</p>
              </div>
              <p className={cn("text-sm font-semibold tabular-nums", amountClass(Number(form.initialBalance) || 0))}>
                {formatCurrency(Number(form.initialBalance) || 0)}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-name">Nombre</Label>
              <Input
                id="account-name"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Cuenta nómina"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <div role="radiogroup" aria-label="Tipo de cuenta" className="grid grid-cols-4 gap-1.5">
                {ACCOUNT_TYPES.map((t) => {
                  const selected = form.type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={typeKeys.tabIndex(t.value)}
                      onKeyDown={typeKeys.onKeyDown}
                      onClick={() => setForm({ ...form, type: t.value })}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected
                          ? "border-primary/40 bg-primary/5 text-foreground ring-1 ring-primary/30"
                          : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <t.icon className={cn("size-4", selected && "text-primary-600 dark:text-primary")} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-initial-balance">Saldo inicial</Label>
              <div className="relative">
                <Input
                  id="account-initial-balance"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form.initialBalance}
                  onChange={(e) => setForm({ ...form, initialBalance: e.target.value })}
                  placeholder="0,00"
                  className="pr-8 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {isLoan(form.type)
                  ? "Lo que debías al empezar a usar la cuenta, en negativo (p. ej. −95000). Cada cuota será un traspaso desde tu banco."
                  : "El saldo actual se calcula sumando las transacciones a este saldo inicial."}
              </p>
            </div>

            {isLoan(form.type) && (
              <fieldset className="space-y-3 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium text-foreground">Condiciones <span className="font-normal text-muted-foreground">(para el cuadro de amortización)</span></legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-principal">Importe prestado (€)</Label>
                    <DecimalInput id="loan-principal" value={form.loanPrincipal} onValueChange={(v) => setForm({ ...form, loanPrincipal: v })} placeholder="150.000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-rate">Interés (TIN %)</Label>
                    <DecimalInput id="loan-rate" value={form.loanRate} onValueChange={(v) => setForm({ ...form, loanRate: v })} placeholder="2,95" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-years">Plazo (años)</Label>
                    <DecimalInput id="loan-years" value={form.loanYears} onValueChange={(v) => setForm({ ...form, loanYears: v })} placeholder="25" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="loan-start">Primera cuota</Label>
                    <Input id="loan-start" type="date" value={form.loanStartDate} onChange={(e) => setForm({ ...form, loanStartDate: e.target.value })} />
                  </div>
                </div>
              </fieldset>
            )}

            <div className="space-y-2">
              <Label>Color</Label>
              <ColorSwatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-b-xl border-t border-border bg-muted/30 px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {editing ? "Guardar cambios" : "Crear cuenta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tarjeta de cuenta ──────────────────────────────────────────
function AccountCard({
  account, share, onEdit, onArchive, onDelete, onReconcile, onAmortization, onValuation,
}: {
  account: Account;
  share: number | null;
  onReconcile: () => void;
  onAmortization: () => void;
  onValuation: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const meta = typeMeta(account.type);
  const Icon = meta.icon;
  const change = account.balance - account.initialBalance;
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-shadow hover:shadow-md",
        account.archived && "opacity-70",
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-0.5", darkBoost(account.color))} style={{ backgroundColor: account.color }} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm", darkBoost(account.color))} style={{ backgroundColor: account.color }}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{account.name}</h3>
          <p className="text-xs text-muted-foreground">
            {meta.label}
            {account.archived && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">Archivada</span>}
          </p>
        </div>
        <RowActions
          itemLabel={account.name}
          actions={[
            ...(isLoan(account.type) && hasLoanTerms(account) ? [{ label: "Cuadro de amortización", icon: CalendarRange, onSelect: onAmortization }] : []),
            ...(account.type === "investment" ? [{ label: "Actualizar valor", icon: TrendingUp, onSelect: onValuation }] : []),
            { label: "Conciliar con el banco", icon: Scale, onSelect: onReconcile },
            { label: "Editar", icon: Pencil, onSelect: onEdit },
            { label: account.archived ? "Restaurar" : "Archivar", icon: account.archived ? ArchiveRestore : Archive, onSelect: onArchive },
            { label: "Eliminar", icon: Trash2, onSelect: onDelete, destructive: true, separated: true },
          ]}
        />
      </div>

      <p className={cn("mt-5 text-2xl font-semibold tracking-tight tabular-nums", amountClass(account.balance))}>
        {formatCurrency(account.balance)}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {change === 0 ? "Sin movimientos" : `${change > 0 ? "+" : "−"}${formatCurrency(Math.abs(change))} desde el inicio`}
        </span>
        {share != null && <span className="tabular-nums">{formatPct(share)} del total</span>}
      </div>
      {share != null && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", darkBoost(account.color))} style={{ width: `${Math.min(100, share)}%`, backgroundColor: account.color }} />
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">
          {account.valuation
            ? `Valorada el ${new Date(`${account.valuation.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`
            : isLoan(account.type) && account.loanPrincipal != null
              ? `${formatCurrency(account.loanPrincipal)}${account.loanRate != null ? ` al ${formatRate(account.loanRate)}` : ""}`
              : account.lastReconciledAt
                ? `Conciliada el ${new Date(account.lastReconciledAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}`
                : "Sin conciliar"}
          {account.unclearedCount > 0 && ` · ${plural(account.unclearedCount, "pendiente", "pendientes")}`}
        </span>
        {/* Antes la tarjeta no llevaba a sus movimientos. */}
        <a href={transactionsHref({ accountId: account.id })} className="font-medium text-foreground underline-offset-2 hover:underline">
          Movimientos
        </a>
      </div>
    </article>
  );
}

// ─── Página ─────────────────────────────────────────────────────
function AccountsView() {
  const queryClient = useQueryClient();
  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const [reconcileTarget, setReconcileTarget] = useState<Account | null>(null);
  const [amortizationTarget, setAmortizationTarget] = useState<Account | null>(null);
  const [valuationTarget, setValuationTarget] = useState<Account | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const createMut = useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Cuenta creada correctamente");
      closeDialog();
    },
    onError: (e: Error) => toast.error("Error al crear la cuenta", { description: e.message }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateAccount>[1] }) =>
      updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Cuenta actualizada");
      closeDialog();
    },
    onError: (e: Error) => toast.error("Error al actualizar la cuenta", { description: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Cuenta eliminada");
    },
    onError: (e: Error) => toast.error("Error al eliminar la cuenta", { description: e.message }),
  });

  const archiveMut = useMutation({
    mutationFn: toggleAccountArchive,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(result.archived ? "Cuenta archivada" : "Cuenta restaurada");
    },
    onError: (e: Error) => toast.error("Error al cambiar estado de archivo", { description: e.message }),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({
      name: a.name, type: a.type, color: a.color, initialBalance: String(a.initialBalance),
      loanPrincipal: a.loanPrincipal, loanRate: a.loanRate,
      loanYears: a.loanTermMonths != null ? Math.round((a.loanTermMonths / 12) * 100) / 100 : null,
      loanStartDate: a.loanStartDate ?? "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    const data = {
      name: form.name.trim(),
      type: form.type,
      color: form.color,
      initialBalance: form.initialBalance ? parseFloat(form.initialBalance) : 0,
      // Fuera de préstamos se borran (por si se cambió el tipo).
      ...(isLoan(form.type)
        ? {
            loanPrincipal: form.loanPrincipal && form.loanPrincipal > 0 ? form.loanPrincipal : null,
            loanRate: form.loanRate != null && form.loanRate >= 0 ? form.loanRate : null,
            loanTermMonths: form.loanYears && form.loanYears > 0 ? Math.max(1, Math.round(form.loanYears * 12)) : null,
            loanStartDate: form.loanStartDate || null,
          }
        : { loanPrincipal: null, loanRate: null, loanTermMonths: null, loanStartDate: null }),
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  const active = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const archived = useMemo(() => accounts.filter((a) => a.archived), [accounts]);

  const stats = useMemo(() => {
    const sumBy = (types: AccountType[]) => active.filter((a) => types.includes(a.type)).reduce((s, a) => s + a.balance, 0);
    return {
      total: active.reduce((s, a) => s + a.balance, 0),
      liquid: sumBy(["bank", "cash"]),
      investment: sumBy(["investment"]),
      cards: sumBy(["credit_card"]),
      debts: sumBy(["credit_card", "loan", "mortgage"]),
      hasLoans: active.some((a) => isLoan(a.type)),
      positiveTotal: active.reduce((s, a) => s + Math.max(0, a.balance), 0),
    };
  }, [active]);

  // Reparto del saldo positivo entre cuentas activas (ordenado de mayor a menor).
  const distribution = useMemo(
    () => active.filter((a) => a.balance > 0).sort((a, b) => b.balance - a.balance),
    [active],
  );

  if (isLoading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No se pudieron cargar las cuentas"
        description="Revisa tu conexión y vuelve a intentarlo en unos segundos."
      >
        <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["accounts"] })}>Reintentar</Button>
      </EmptyState>
    );
  }

  const shown = view === "active" ? active : archived;
  const newButton = (
    <Button onClick={openCreate} className="gap-1.5">
      <Plus className="size-4" /> Nueva cuenta
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Tus cuentas,"
        accent="en orden."
        description="Saldos de tus cuentas bancarias, tarjetas, efectivo, inversiones y préstamos."
        actions={accounts.length > 0 ? newButton : undefined}
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Todavía no tienes cuentas"
          description="Crea tu primera cuenta para empezar a registrar movimientos, o importa tus datos desde YNAB."
        >
          {newButton}
          <a href="/app/import" className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
            <Download className="size-4" /> Importar YNAB
          </a>
        </EmptyState>
      ) : (
        <>
          <StatGrid className="grid-cols-2">
            <StatCard
              className="col-span-2 sm:col-span-1"
              label={stats.hasLoans ? "Patrimonio neto" : "Saldo total"}
              value={formatCurrency(stats.total)}
              icon={Wallet}
              hint={`${active.length} ${active.length === 1 ? "cuenta activa" : "cuentas activas"}`}
              emphasis
            />
            <StatCard label="Liquidez" value={formatCurrency(stats.liquid)} icon={Landmark} hint="Bancos y efectivo" />
            <StatCard label="Inversión" value={formatCurrency(stats.investment)} icon={PiggyBank} hint="Cuentas de inversión" />
            {stats.hasLoans ? (
              <StatCard
                className="col-span-2 sm:col-span-1"
                label="Deudas"
                value={<span className={amountClass(stats.debts)}>{formatCurrency(stats.debts)}</span>}
                icon={HandCoins}
                hint="Tarjetas, préstamos e hipoteca"
              />
            ) : (
              <StatCard
                className="col-span-2 sm:col-span-1"
                label="Tarjetas"
                value={<span className={amountClass(stats.cards)}>{formatCurrency(stats.cards)}</span>}
                icon={CreditCard}
                hint={stats.cards < 0 ? "Saldo pendiente de pago" : "Sin deuda pendiente"}
              />
            )}
          </StatGrid>

          {distribution.length > 1 && stats.positiveTotal > 0 && (
            <SectionCard className="mt-6" title="Reparto del saldo" description="Peso de cada cuenta en tu saldo positivo">
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
                {distribution.map((a) => (
                  <div
                    key={a.id}
                    className={cn("h-full first:rounded-l-full last:rounded-r-full", darkBoost(a.color))}
                    style={{ width: `${(a.balance / stats.positiveTotal) * 100}%`, backgroundColor: a.color }}
                    title={`${a.name}: ${formatCurrency(a.balance)}`}
                  />
                ))}
              </div>
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                {distribution.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    <span className={cn("size-2 rounded-full", darkBoost(a.color))} style={{ backgroundColor: a.color }} aria-hidden="true" />
                    <span className="text-foreground">{a.name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatPct((a.balance / stats.positiveTotal) * 100)}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <div className="mt-8 mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {view === "active" ? "Cuentas activas" : "Cuentas archivadas"}
            </h2>
            {archived.length > 0 && (
              <Segmented
                aria-label="Filtrar cuentas"
                value={view}
                onChange={setView}
                options={[
                  { value: "active", label: `Activas (${active.length})` },
                  { value: "archived", label: `Archivadas (${archived.length})` },
                ]}
              />
            )}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              compact
              icon={view === "active" ? Wallet : Archive}
              title={view === "active" ? "No hay cuentas activas" : "No hay cuentas archivadas"}
              description={view === "active" ? "Todas tus cuentas están archivadas. Restaura alguna o crea una nueva." : "Las cuentas que archives aparecerán aquí."}
              className="rounded-xl border border-dashed border-border"
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  share={!a.archived && a.balance > 0 && stats.positiveTotal > 0 ? (a.balance / stats.positiveTotal) * 100 : null}
                  onEdit={() => openEdit(a)}
                  onArchive={() => archiveMut.mutate(a.id)}
                  onDelete={() => setDeleteTarget(a)}
                  onReconcile={() => setReconcileTarget(a)}
                  onAmortization={() => setAmortizationTarget(a)}
                  onValuation={() => setValuationTarget(a)}
                />
              ))}
              {view === "active" && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                >
                  <span className="flex size-9 items-center justify-center rounded-full border border-border bg-card">
                    <Plus className="size-4" />
                  </span>
                  Añadir cuenta
                </button>
              )}
            </div>
          )}
        </>
      )}

      <AccountDialog
        open={dialogOpen}
        editing={editing}
        form={form}
        setForm={setForm}
        onClose={closeDialog}
        onSubmit={handleSubmit}
        pending={createMut.isPending || updateMut.isPending}
      />

      <ConfirmModal
        open={!!deleteTarget}
        title="Eliminar cuenta"
        message={`¿Seguro que quieres eliminar "${deleteTarget?.name ?? ""}"? Se perderán todas sus transacciones.`}
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => { if (deleteTarget) { deleteMut.mutate(deleteTarget.id); setDeleteTarget(null); } }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ReconcileDialog account={reconcileTarget} onClose={() => setReconcileTarget(null)} />
      <AmortizationDialog account={amortizationTarget} onClose={() => setAmortizationTarget(null)} />
      <ValuationDialog account={valuationTarget} onClose={() => setValuationTarget(null)} />
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Providers>
      <AccountsView />
    </Providers>
  );
}
