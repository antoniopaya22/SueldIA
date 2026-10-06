import { Fragment, useMemo } from "react";
import {
  CheckCircle2, Circle, ChevronDown, Copy, ChevronUp, ChevronsUpDown, Pencil, Repeat, Trash2, CalendarClock,
} from "lucide-react";
import type { Account, Transaction } from "../../../lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "../../../lib/format";
import { RowActions, type RowAction } from "../RowActions";
import { darkBoost } from "../../../lib/color";
import { TYPE_META, formatDateShort, formatDayHeading } from "./shared";
import { cn } from "cn";

export type SortField = "date" | "payee" | "category" | "amount" | "type";
export type SortDir = "asc" | "desc";

interface Props {
  transactions: Transaction[];
  accountsById: Map<number, Account>;
  showAccount: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  today: string;
  onEdit: (tx: Transaction) => void;
  onToggleCleared: (tx: Transaction) => void;
  onSchedule: (tx: Transaction) => void;
  onDuplicate: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  /** Modo selección: casillas para actuar sobre varios movimientos a la vez. */
  selection?: {
    ids: Set<number>;
    onToggle: (id: number) => void;
    onToggleAll: (ids: number[], select: boolean) => void;
  };
}

// ─── Helpers de presentación ────────────────────────────────────
function signedAmount(tx: Transaction) {
  if (tx.type === "income") return { sign: "+", cls: TYPE_META.income.text };
  if (tx.type === "expense") return { sign: "−", cls: TYPE_META.expense.text };
  return { sign: tx.transferDirection === "inflow" ? "+" : "−", cls: TYPE_META.transfer.text };
}

function categoryLabel(tx: Transaction) {
  if (tx.type === "transfer") {
    return tx.targetAccountName ? `${tx.transferDirection === "inflow" ? "Desde" : "Hacia"} ${tx.targetAccountName}` : "Entre cuentas";
  }
  return tx.categoryName || null;
}

function dayNet(txs: Transaction[]) {
  return txs.reduce((s, t) => s + (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0), 0);
}

function useRowActions(props: Props) {
  return (tx: Transaction): RowAction[] => {
    const canEdit = tx.type !== "transfer" || tx.transferDirection !== "inflow";
    const canSchedule = tx.type !== "transfer" && !tx.recurringTransactionId;
    const actions: RowAction[] = [];
    if (canEdit) actions.push({ label: "Editar", icon: Pencil, onSelect: () => props.onEdit(tx) });
    actions.push({
      label: tx.cleared ? "Marcar como pendiente" : "Marcar como liquidada",
      icon: tx.cleared ? Circle : CheckCircle2,
      onSelect: () => props.onToggleCleared(tx),
    });
    if (tx.type !== "transfer") actions.push({ label: "Duplicar", icon: Copy, onSelect: () => props.onDuplicate(tx) });
    if (canSchedule) actions.push({ label: "Programar como recurrente", icon: Repeat, onSelect: () => props.onSchedule(tx) });
    if (!tx.recurringTransactionId) {
      actions.push({ label: "Eliminar", icon: Trash2, onSelect: () => props.onDelete(tx), destructive: true, separated: true });
    }
    return actions;
  };
}

function ClearedToggle({ tx, onToggle }: { tx: Transaction; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label={tx.cleared ? "Liquidada. Marcar como pendiente" : "Pendiente. Marcar como liquidada"}
      title={tx.cleared ? "Liquidada" : "Pendiente"}
    >
      {tx.cleared
        ? <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        : <Circle className="size-4 text-muted-foreground/60" aria-hidden="true" />}
    </button>
  );
}

function TxBadges({ tx, today }: { tx: Transaction; today: string }) {
  const isFutureRecurring = !!tx.recurringTransactionId && !!tx.scheduledFor && tx.scheduledFor > today && !tx.cleared;
  if (!tx.recurringTransactionId && !isFutureRecurring) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tx.recurringTransactionId && (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-700 dark:text-primary">
          <Repeat className="size-2.5" aria-hidden="true" /> Recurrente
        </span>
      )}
      {isFutureRecurring && tx.scheduledFor && (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
          <CalendarClock className="size-2.5" aria-hidden="true" /> Vence {formatDateShort(tx.scheduledFor)}
        </span>
      )}
    </span>
  );
}

function SortHeader({ field, label, sortBy, sortDir, onSort, align = "left" }: {
  field: SortField; label: string; sortBy: SortField; sortDir: SortDir; onSort: (f: SortField) => void; align?: "left" | "right";
}) {
  const active = sortBy === field;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        active && "text-foreground",
        align === "right" && "flex-row-reverse",
      )}
      aria-label={`Ordenar por ${label.toLowerCase()}`}
    >
      {label}
      <Icon className={cn("size-3", active ? "text-primary-600 dark:text-primary" : "text-muted-foreground/60")} aria-hidden="true" />
    </button>
  );
}

// ─── Tabla + lista ──────────────────────────────────────────────
export function TransactionTable(props: Props) {
  const { transactions, accountsById, showAccount, sortBy, sortDir, onSort, today, onToggleCleared, selection } = props;
  const allSelected = !!selection && transactions.length > 0 && transactions.every((t) => selection.ids.has(t.id));
  const actionsFor = useRowActions(props);
  const grouped = sortBy === "date";

  const groups = useMemo(() => {
    if (!grouped) return [{ key: "all", date: null as string | null, items: transactions }];
    const out: { key: string; date: string | null; items: Transaction[] }[] = [];
    for (const tx of transactions) {
      const last = out[out.length - 1];
      if (last && last.date === tx.date) last.items.push(tx);
      else out.push({ key: tx.date, date: tx.date, items: [tx] });
    }
    return out;
  }, [transactions, grouped]);

  const colCount = 4 + (grouped ? 0 : 1) + (showAccount ? 1 : 0) + 1 + (selection ? 1 : 0);

  return (
    <>
      {/* Escritorio */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="sticky top-14 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              {selection && (
                <th className="w-10 py-2.5 pl-4">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => selection.onToggleAll(transactions.map((t) => t.id), checked === true)}
                    aria-label="Seleccionar todos los movimientos de esta página"
                  />
                </th>
              )}
              <th className={cn("w-12 py-2.5", selection ? "pl-1" : "pl-4")}><span className="sr-only">Estado</span></th>
              {!grouped && (
                <th className="py-2.5 pr-4 font-medium whitespace-nowrap">
                  <SortHeader field="date" label="Fecha" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                </th>
              )}
              <th className="py-2.5 pr-4 font-medium">
                <SortHeader field="payee" label="Movimiento" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              </th>
              <th className="py-2.5 pr-4 font-medium">
                <SortHeader field="category" label="Categoría" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              </th>
              {showAccount && <th className="py-2.5 pr-4 font-medium">Cuenta</th>}
              <th className="py-2.5 pr-2 text-right font-medium">
                <SortHeader field="amount" label="Importe" sortBy={sortBy} sortDir={sortDir} onSort={onSort} align="right" />
              </th>
              <th className="w-12 py-2.5 pr-3"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {g.date && (
                  <tr className="border-b border-border bg-muted/40">
                    <td colSpan={colCount} className="px-4 py-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{formatDayHeading(g.date, today)}</span>
                        <DayNet value={dayNet(g.items)} />
                      </div>
                    </td>
                  </tr>
                )}
                {g.items.map((tx) => {
                  const meta = TYPE_META[tx.type];
                  const amt = signedAmount(tx);
                  const cat = categoryLabel(tx);
                  const account = accountsById.get(tx.accountId);
                  return (
                    <tr key={tx.id} className={cn("group/row border-b border-border last:border-0 transition-colors hover:bg-muted/40", selection?.ids.has(tx.id) && "bg-primary/5 hover:bg-primary/10")}>
                      {selection && (
                        <td className="py-2 pl-4 align-middle">
                          <Checkbox
                            checked={selection.ids.has(tx.id)}
                            onCheckedChange={() => selection.onToggle(tx.id)}
                            aria-label={`Seleccionar ${tx.payee || "movimiento"}`}
                          />
                        </td>
                      )}
                      <td className={cn("py-2 align-middle", selection ? "pl-1" : "pl-4")}>
                        <ClearedToggle tx={tx} onToggle={() => onToggleCleared(tx)} />
                      </td>
                      {!grouped && (
                        <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">{formatDateShort(tx.date)}</td>
                      )}
                      <td className="max-w-0 py-2 pr-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.tile)}>
                            <meta.icon className="size-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {tx.payee || (tx.type === "transfer" ? "Transferencia" : "Sin beneficiario")}
                            </p>
                            {(tx.memo || tx.recurringTransactionId) && (
                              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                                <TxBadges tx={tx} today={today} />
                                {tx.memo && <span className="truncate">{tx.memo}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-0 py-2 pr-4">
                        {cat ? (
                          <span className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground">
                            {tx.type !== "transfer" && tx.groupName && <span className="mr-1 text-muted-foreground">{tx.groupName} ·</span>}
                            <span className="truncate">{cat}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin categoría</span>
                        )}
                      </td>
                      {showAccount && (
                        <td className="py-2 pr-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <span className={cn("size-2 rounded-full", darkBoost(account?.color))} style={{ backgroundColor: account?.color ?? "var(--muted-foreground)" }} aria-hidden="true" />
                            {tx.accountName}
                          </span>
                        </td>
                      )}
                      <td className={cn("py-2 pr-2 text-right font-medium whitespace-nowrap tabular-nums", amt.cls)}>
                        {amt.sign}{formatCurrency(tx.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <RowActions
                          itemLabel={tx.payee || "la transacción"}
                          actions={actionsFor(tx)}
                          className="opacity-60 group-hover/row:opacity-100 data-popup-open:opacity-100"
                        />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Móvil */}
      <div className="md:hidden">
        {groups.map((g) => (
          <div key={g.key}>
            {g.date && (
              <div className="sticky top-14 z-10 flex items-center justify-between border-b border-border bg-muted/80 px-4 py-1.5 text-xs backdrop-blur">
                <span className="font-medium text-foreground">{formatDayHeading(g.date, today)}</span>
                <DayNet value={dayNet(g.items)} />
              </div>
            )}
            <ul className="divide-y divide-border">
              {g.items.map((tx) => {
                const meta = TYPE_META[tx.type];
                const amt = signedAmount(tx);
                const cat = categoryLabel(tx);
                return (
                  <li key={tx.id} className={cn("flex items-center gap-3 px-4 py-3", selection?.ids.has(tx.id) && "bg-primary/5")}>
                    {selection && (
                      <Checkbox
                        checked={selection.ids.has(tx.id)}
                        onCheckedChange={() => selection.onToggle(tx.id)}
                        aria-label={`Seleccionar ${tx.payee || "movimiento"}`}
                      />
                    )}
                    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", meta.tile)}>
                      <meta.icon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {tx.payee || (tx.type === "transfer" ? "Transferencia" : "Sin beneficiario")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {!grouped && `${formatDateShort(tx.date)} · `}
                        {cat ?? "Sin categoría"}
                        {showAccount && ` · ${tx.accountName}`}
                      </p>
                      <div className="mt-1"><TxBadges tx={tx} today={today} /></div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <p className={cn("text-sm font-medium whitespace-nowrap tabular-nums", amt.cls)}>{amt.sign}{formatCurrency(tx.amount)}</p>
                      <span className={cn("text-[10px]", tx.cleared ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                        {tx.cleared ? "Liquidada" : "Pendiente"}
                      </span>
                    </div>
                    <RowActions itemLabel={tx.payee || "la transacción"} actions={actionsFor(tx)} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

function DayNet({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className={cn("font-medium tabular-nums", value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
      {value > 0 ? "+" : "−"}{formatCurrency(Math.abs(value))}
    </span>
  );
}
