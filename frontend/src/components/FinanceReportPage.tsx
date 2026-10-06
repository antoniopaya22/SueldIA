import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleDollarSign, PiggyBank, RefreshCcw,
  Scale, Sparkles, Store, TrendingDown, TrendingUp,
} from "lucide-react";
import { getMonthReport, type MonthReport, type ReportCategory } from "../lib/api";
import { formatCurrency, formatMonthLabel, formatPct } from "../lib/format";
import { monthRange, transactionsHref } from "../lib/transaction-filters";
import { Providers } from "./Providers";
import { EmptyState } from "./ui/EmptyState";
import {
  PageHeader, StatCard, StatGrid, SectionCard, PageHeaderSkeleton, StatCardSkeleton, ListCardSkeleton, type StatDelta,
} from "./app";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const MONTHS_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_FULL[Number(m) - 1]} ${y}`;
}

/** El mes sale de ?mes=YYYY-MM (compartible) y se escribe de vuelta al cambiarlo. */
function initialMonth(): string {
  if (typeof window === "undefined") return currentMonth();
  const value = new URLSearchParams(window.location.search).get("mes");
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentMonth();
}

/** Variación frente al mes anterior; `invert` para gastos (subir es malo). */
function deltaVsPrevious(current: number, previous: number, invert = false): StatDelta | undefined {
  if (!previous) return undefined;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return undefined;
  const trend = Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down";
  const tone = trend === "flat" ? "neutral" : (trend === "up") !== invert ? "positive" : "negative";
  return { value: `${change > 0 ? "+" : ""}${formatPct(change)}`, trend, tone, label: "vs. mes anterior" };
}

const categoryHref = (c: ReportCategory, month: string) =>
  transactionsHref({
    ...(c.categoryId === null ? { uncategorized: true } : { categoryId: c.categoryId }),
    type: "expense",
    cleared: "true", // el informe solo cuenta lo liquidado
    ...monthRange(month),
  });

function ChangeList({
  items, month, tone, empty,
}: {
  items: ReportCategory[];
  month: string;
  tone: "up" | "down";
  empty: string;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((c) => Math.abs(c.diff)), 1);
  return (
    <ul className="space-y-3.5">
      {items.map((c) => (
        <li key={`${c.categoryId}`}>
          <div className="flex items-baseline justify-between gap-3">
            <a
              href={categoryHref(c, month)}
              className="min-w-0 truncate rounded-sm text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              title={`Ver movimientos de ${c.name}`}
            >
              {c.name}
            </a>
            <span className={cn("shrink-0 text-sm font-semibold tabular-nums", tone === "up" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
              {c.diff > 0 ? "+" : "−"}{formatCurrency(Math.abs(c.diff))}
              {c.diffPct !== null && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.diffPct > 0 ? "+" : ""}{formatPct(c.diffPct)}</span>}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {formatCurrency(c.spent)} este mes · media {c.average > 0 ? formatCurrency(c.average) : "—"}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", tone === "up" ? "bg-red-500/80" : "bg-emerald-500/80")}
              style={{ width: `${Math.max((Math.abs(c.diff) / max) * 100, 3)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ReportSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ListCardSkeleton rows={4} />
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  );
}

function ReportBody({ report, month }: { report: MonthReport; month: string }) {
  const { totals, previousTotals } = report;
  const noHistory = report.historyMonths === 0;
  // Con el mes a medias, las variaciones frente a meses completos engañan: se enseñan las cifras, no el %.
  const partial = report.partial;
  const topCategories = report.categories.filter((c) => c.spent > 0).slice(0, 10);

  return (
    <>
      <StatGrid>
        <StatCard
          label="Ingresos"
          value={formatCurrency(totals.income)}
          icon={ArrowUpRight}
          delta={partial ? undefined : deltaVsPrevious(totals.income, previousTotals.income)}
          hint={`${formatMonthLabel(report.previousMonth)}${partial ? " (completo)" : ""}: ${formatCurrency(previousTotals.income)}`}
        />
        <StatCard
          label="Gastos"
          value={formatCurrency(totals.expense)}
          icon={ArrowDownRight}
          delta={partial ? undefined : deltaVsPrevious(totals.expense, previousTotals.expense, true)}
          hint={`${formatMonthLabel(report.previousMonth)}${partial ? " (completo)" : ""}: ${formatCurrency(previousTotals.expense)}`}
        />
        <StatCard
          label="Balance"
          value={<span className={totals.net < 0 ? "text-red-600 dark:text-red-400" : undefined}>{totals.net > 0 ? "+" : ""}{formatCurrency(totals.net)}</span>}
          icon={Scale}
          hint="Ingresos menos gastos del mes"
        />
        <StatCard
          label="Tasa de ahorro"
          value={totals.savingsRate === null ? "—" : formatPct(totals.savingsRate)}
          icon={PiggyBank}
          hint={totals.savingsRate === null ? "Sin ingresos este mes" : previousTotals.savingsRate !== null ? `Mes anterior: ${formatPct(previousTotals.savingsRate)}` : undefined}
        />
      </StatGrid>

      {partial && !noHistory && (
        <p className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" role="status">
          Este mes aún no ha terminado, así que la comparación es provisional: solo te señalamos lo que ya supera tu media. Lo demás puede ser que todavía no haya llegado.
        </p>
      )}

      {noHistory && (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Todavía no hay meses anteriores con gasto con los que comparar. Cuando tengas algún mes más de historial verás aquí qué ha cambiado.
        </p>
      )}

      {!noHistory && (
        <div className={cn("mt-6 grid gap-6", !partial && "lg:grid-cols-2")}>
          <SectionCard
            title="Gastas más que de costumbre"
            description={`Frente a la media de los ${report.historyMonths} ${report.historyMonths === 1 ? "mes anterior" : "meses anteriores"}`}
            icon={TrendingUp}
          >
            <ChangeList items={report.increases} month={month} tone="up" empty="Nada se sale al alza este mes." />
          </SectionCard>
          {!partial && (
            <SectionCard title="Gastas menos" description="Categorías por debajo de tu media" icon={TrendingDown}>
              <ChangeList items={report.decreases} month={month} tone="down" empty="Ninguna categoría baja respecto a tu media." />
            </SectionCard>
          )}
        </div>
      )}

      {(report.unusual.length > 0 || report.newPayees.length > 0) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <SectionCard title="Gastos inusuales" description="Mucho más de lo habitual en su categoría" icon={Sparkles} flush>
            {report.unusual.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">Nada fuera de lo normal.</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.unusual.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={transactionsHref({ search: u.payee, type: "expense", cleared: "true", ...monthRange(month) })}
                        className="block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {u.payee}
                      </a>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.categoryName} · {u.ratio.toLocaleString("es-ES", { maximumFractionDigits: 1 })}× lo habitual ({formatCurrency(u.typical)})
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(u.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Sitios nuevos" description="Gastos en beneficiarios que no aparecían antes" icon={Store} flush>
            {report.newPayees.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">Ningún beneficiario nuevo relevante.</p>
            ) : (
              <ul className="divide-y divide-border">
                {report.newPayees.map((p) => (
                  <li key={p.payee} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={transactionsHref({ search: p.payee, type: "expense", cleared: "true", ...monthRange(month) })}
                        className="block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {p.payee}
                      </a>
                      <p className="text-xs text-muted-foreground">{p.count} {p.count === 1 ? "movimiento" : "movimientos"}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(p.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}

      <SectionCard className="mt-6" title="Gasto por categoría" description="Este mes y tu media habitual" icon={CircleDollarSign} flush>
        {topCategories.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No hay gasto liquidado este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Categoría</th>
                  <th className="px-2 py-2.5 text-right font-medium">Este mes</th>
                  <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Media</th>
                  <th className="px-5 py-2.5 text-right font-medium">Variación</th>
                </tr>
              </thead>
              <tbody>
                {topCategories.map((c) => (
                  <tr key={`${c.categoryId}`} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">
                      <a href={categoryHref(c, month)} className="font-medium text-foreground hover:underline">{c.name}</a>
                      <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{c.groupName}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{formatCurrency(c.spent)}</td>
                    <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{c.average > 0 ? formatCurrency(c.average) : "—"}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {partial && c.diff <= 0 ? (
                        <span className="text-xs text-muted-foreground" title="El mes no ha terminado">—</span>
                      ) : c.diffPct === null ? (
                        <span className="text-xs text-muted-foreground">{noHistory ? "—" : "Nueva"}</span>
                      ) : (
                        <span className={cn("font-medium", c.diff > 0 ? "text-red-600 dark:text-red-400" : c.diff < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                          {c.diffPct > 0 ? "+" : ""}{formatPct(c.diffPct)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

function ReportView() {
  const [month, setMonth] = useState(initialMonth);

  const changeMonth = (next: string) => {
    setMonth(next);
    const url = new URL(window.location.href);
    url.searchParams.set("mes", next);
    window.history.replaceState(null, "", url);
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["finance-report", month],
    queryFn: () => getMonthReport(month),
  });

  const switcher = (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Mes anterior">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 px-1 text-center text-sm font-medium text-foreground tabular-nums">{monthLabel(month)}</span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => changeMonth(shiftMonth(month, 1))}
        disabled={month >= currentMonth()}
        aria-label="Mes siguiente"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );

  const header = (
    <PageHeader
      title="Informe"
      accent="del mes."
      description="Cómo ha ido el mes frente a tu media: qué ha subido, qué ha bajado y qué se sale de lo habitual."
    >
      {switcher}
    </PageHeader>
  );

  if (error) {
    return (
      <>
        {header}
        <EmptyState icon={AlertTriangle} title="No se pudo cargar el informe" description="Vuelve a intentarlo en unos segundos.">
          <Button onClick={() => refetch()} className="gap-1.5"><RefreshCcw className="size-4" /> Reintentar</Button>
        </EmptyState>
      </>
    );
  }

  if (isLoading || !data) return <ReportSkeleton />;

  const empty = data.totals.income === 0 && data.totals.expense === 0;

  return (
    <div>
      {header}
      {empty ? (
        <EmptyState
          icon={Scale}
          title="Sin movimientos liquidados este mes"
          description="El informe cuenta lo liquidado. Prueba con otro mes o liquida tus movimientos pendientes."
          actionLabel="Ver transacciones"
          actionHref="/app/transactions"
        />
      ) : (
        <ReportBody report={data} month={month} />
      )}
    </div>
  );
}

export default function FinanceReportPage() {
  return (
    <Providers>
      <ReportView />
    </Providers>
  );
}
