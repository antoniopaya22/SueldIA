import { useRef, useState } from "react";
import { Check, Target } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CategoryBudget } from "../../lib/api";
import { formatCurrency, formatMonthLabel } from "../../lib/format";
import { spendProgress, type SpendTone } from "../../lib/budget-progress";
import { monthRange, transactionsHref } from "../../lib/transaction-filters";
import { cn } from "cn";

const BAR_TONE: Record<SpendTone, string> = {
  none: "bg-muted-foreground/30",
  ok: "bg-primary",
  warn: "bg-amber-500",
  over: "bg-red-500",
};

// ─── Celda "Asignado" editable en línea ─────────────────────────
function AssignedCell({
  value, pending, onSave,
}: {
  value: number;
  pending: boolean;
  onSave: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const cancelledRef = useRef(false);

  const startEdit = () => {
    if (pending) return;
    setDraft(value ? String(value) : "0");
    setEditing(true);
  };

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isNaN(parsed) && parsed !== value) onSave(parsed);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        disabled={pending}
        className="w-full cursor-text rounded px-1.5 py-1 text-right tabular-nums text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60"
        title="Editar importe asignado"
      >
        {formatCurrency(value)}
      </button>
    );
  }

  return (
    <input
      type="number"
      step="0.01"
      inputMode="decimal"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.preventDefault(); cancelledRef.current = true; e.currentTarget.blur(); }
      }}
      onBlur={() => {
        setEditing(false);
        if (cancelledRef.current) { cancelledRef.current = false; return; }
        commit();
      }}
      aria-label="Importe asignado"
      className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
    />
  );
}

function targetLabel(c: CategoryBudget): string {
  const t = c.target!;
  return t.type === "monthly"
    ? `Objetivo: ${formatCurrency(t.amount)} al mes`
    : `Objetivo: ${formatCurrency(t.amount)} antes de ${t.targetMonth ? formatMonthLabel(t.targetMonth) : "—"}`;
}

interface Props {
  categories: CategoryBudget[];
  month: string;
  pendingId: number | null;
  onAssign: (categoryId: number, previous: number, next: number) => void;
  onEditTarget: (category: CategoryBudget) => void;
  onCover: (category: CategoryBudget) => void;
  /** Asignar justo lo que falta para cumplir el objetivo de esta categoría. */
  onFund: (category: CategoryBudget) => void;
}

// ─── Tabla de un grupo ───────────────────────────────────────────
export function BudgetTable({ categories, month, pendingId, onAssign, onEditTarget, onCover, onFund }: Props) {
  if (categories.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted-foreground">Sin categorías en este grupo — créalas en Categorías.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Categoría</TableHead>
          <TableHead className="text-right">Asignado</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Gastado</TableHead>
          <TableHead className="pr-5 text-right">Disponible</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((c) => {
          const progress = spendProgress(c);
          const over = c.available < -0.005;
          const spent = progress.spent;
          // Solo gastos liquidados, igual que la cifra: así el total del enlace coincide.
          const spentHref = transactionsHref({ categoryId: c.id, type: "expense", cleared: "true", ...monthRange(month) });
          return (
            <TableRow key={c.id} className="group/row">
              <TableCell className="py-2.5 pl-5 sm:min-w-48">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{c.name}</span>
                  <button
                    type="button"
                    onClick={() => onEditTarget(c)}
                    className={cn(
                      "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50",
                      c.target ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
                    )}
                    aria-label={c.target ? `Editar el objetivo de ${c.name}` : `Poner un objetivo a ${c.name}`}
                    title={c.target ? "Editar objetivo" : "Poner un objetivo"}
                  >
                    <Target className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <div
                  className="mt-1.5 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`Gastado de ${c.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.ratio * 100)}
                  aria-valuetext={
                    progress.limit > 0
                      ? `${formatCurrency(spent)} de ${formatCurrency(progress.limit)}`
                      : spent > 0 ? `${formatCurrency(spent)} sin presupuesto` : "Sin gasto"
                  }
                >
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500", BAR_TONE[progress.tone])}
                    style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                  />
                </div>
                {spent > 0 && (
                  // En móvil la columna "Gastado" se oculta: su dato pasa aquí.
                  <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                    Gastado{" "}
                    <a href={spentHref} className="font-medium text-foreground underline-offset-2 hover:underline">{formatCurrency(spent)}</a>
                  </p>
                )}
                {c.target && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>{targetLabel(c)}</span>
                    {c.target.funded ? (
                      <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3" aria-hidden="true" /> al día
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        · faltan {formatCurrency(c.target.shortfall)}{" "}
                        <button
                          type="button"
                          onClick={() => onFund(c)}
                          disabled={pendingId === c.id}
                          className="cursor-pointer font-medium underline underline-offset-2 outline-none hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60 dark:hover:text-amber-300"
                        >
                          Asignar
                        </button>
                      </span>
                    )}
                  </p>
                )}
              </TableCell>
              <TableCell className="py-1.5 pt-2 text-right align-top">
                <AssignedCell
                  value={c.assigned}
                  pending={pendingId === c.id}
                  onSave={(next) => onAssign(c.id, c.assigned, next)}
                />
              </TableCell>
              <TableCell className="hidden pt-3 pb-2.5 text-right align-top tabular-nums text-foreground sm:table-cell">
                {spent === 0 ? formatCurrency(0) : (
                  <a
                    href={spentHref}
                    className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    title="Ver los movimientos de este mes"
                  >
                    {formatCurrency(spent)}
                  </a>
                )}
              </TableCell>
              <TableCell className="pt-3 pb-2.5 pr-5 text-right align-top">
                <span className={cn("font-medium tabular-nums", over ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                  {formatCurrency(c.available)}
                </span>
                {over && (
                  <button
                    type="button"
                    onClick={() => onCover(c)}
                    className="mt-0.5 block w-full cursor-pointer text-right text-xs font-medium text-primary-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-primary"
                  >
                    Cubrir…
                  </button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
