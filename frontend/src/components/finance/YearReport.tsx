import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Printer, Receipt, Store, Tags, TrendingDown, TrendingUp } from "lucide-react";
import { getYearReport, type YearTotals } from "@/lib/api";
import { formatCurrency, formatMonthLabel, formatPct } from "@/lib/format";
import { transactionsHref } from "@/lib/transaction-filters";
import { SectionCard, StatCard, StatGrid } from "../app";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function delta(current: number, previous: number, invert = false) {
  if (!previous) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const trend = Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
  const good = invert ? pct < 0 : pct > 0;
  return { value: `${pct > 0 ? "+" : ""}${formatPct(pct)}`, trend, tone: Math.abs(pct) < 0.5 ? undefined : good ? "positive" : "negative", label: "vs. año anterior" } as const;
}

/** Barras de ingresos y gastos por mes (CSS, sin gráfico: se imprime bien). */
function MonthBars({ months }: { months: Array<{ month: string } & YearTotals> }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  return (
    <ul className="space-y-2">
      {months.map((m) => (
        <li key={m.month} className="grid grid-cols-[3.5rem_1fr_6.5rem] items-center gap-3 text-xs">
          <span className="text-muted-foreground">{formatMonthLabel(m.month)}</span>
          <span className="space-y-1" aria-hidden="true">
            <span className="block h-1.5 rounded-full bg-[var(--chart-1)]" style={{ width: `${(m.income / max) * 100}%` }} />
            <span className="block h-1.5 rounded-full bg-[var(--chart-2)]" style={{ width: `${(m.expense / max) * 100}%` }} />
          </span>
          <span className={cn("text-right tabular-nums", m.net < 0 ? "text-destructive" : "text-foreground")}>
            {m.net >= 0 ? "+" : ""}{formatCurrency(m.net)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function YearReportView({ year, onYearChange, thisYear }: { year: number; onYearChange: (y: number) => void; thisYear: number }) {
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["finance-report-year", year],
    queryFn: () => getYearReport(year),
    placeholderData: keepPreviousData,
  });

  const switcher = (
    <div className="flex items-center gap-1 print:hidden">
      <Button variant="outline" size="icon-sm" onClick={() => onYearChange(year - 1)} aria-label="Año anterior"><ChevronLeft className="size-4" /></Button>
      <span className="min-w-16 text-center text-sm font-medium tabular-nums">{year}</span>
      <Button variant="outline" size="icon-sm" onClick={() => onYearChange(year + 1)} disabled={year >= thisYear} aria-label="Año siguiente"><ChevronRight className="size-4" /></Button>
      <Button variant="ghost" size="sm" className="ml-2 gap-1.5" onClick={() => window.print()}><Printer className="size-4" /> Imprimir</Button>
    </div>
  );

  if (isLoading || !data) return <>{switcher}<div className="mt-6 h-64 animate-pulse rounded-xl bg-muted/50" /></>;
  const empty = data.totals.income === 0 && data.totals.expense === 0;
  const period = data.partial ? `de enero a ${MONTHS[data.throughMonth - 1]}` : "del año completo";

  return (
    <div className={cn("transition-opacity", isPlaceholderData && "opacity-60")}>
      {switcher}
      {empty ? (
        <EmptyState className="mt-6" icon={Receipt} title={`Sin movimientos liquidados en ${year}`} description="Prueba con otro año." />
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            Cifras {period}{data.partial ? `, frente al mismo periodo de ${year - 1}` : `, frente a ${year - 1}`}.
          </p>
          <StatGrid className="mt-4">
            <StatCard label="Ingresos" value={formatCurrency(data.totals.income)} icon={TrendingUp} delta={delta(data.totals.income, data.previousTotals.income)} />
            <StatCard label="Gastos" value={formatCurrency(data.totals.expense)} icon={TrendingDown} delta={delta(data.totals.expense, data.previousTotals.expense, true)} />
            <StatCard label="Ahorro" value={formatCurrency(data.totals.net)} emphasis delta={delta(data.totals.net, data.previousTotals.net)} />
            <StatCard label="Tasa de ahorro" value={data.totals.savingsRate != null ? formatPct(data.totals.savingsRate) : "—"} hint={data.previousTotals.savingsRate != null ? `${year - 1}: ${formatPct(data.previousTotals.savingsRate)}` : undefined} />
          </StatGrid>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <SectionCard title="Mes a mes" description="Ingresos (arriba), gastos (abajo) y lo que quedó">
              <MonthBars months={data.months} />
              {(data.bestMonth || data.worstMonth) && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {data.bestMonth && <>Mejor mes: <strong className="font-medium text-foreground">{MONTHS[Number(data.bestMonth.month.slice(5)) - 1]}</strong> ({formatCurrency(data.bestMonth.net)}). </>}
                  {data.worstMonth && <>Peor mes: <strong className="font-medium text-foreground">{MONTHS[Number(data.worstMonth.month.slice(5)) - 1]}</strong> ({formatCurrency(data.worstMonth.net)}).</>}
                </p>
              )}
            </SectionCard>
            <SectionCard title="En qué se fue" description={`Categorías con más gasto, y su cambio frente a ${year - 1}`} icon={Tags} flush>
              <ul className="divide-y divide-border">
                {data.categories.map((c) => (
                  <li key={String(c.categoryId)}>
                    <a href={transactionsHref({ categoryId: c.categoryId ?? undefined, uncategorized: c.categoryId == null ? true : undefined, type: "expense", from: `${year}-01-01`, to: `${year}-12-31` })} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/40">
                      <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                      {c.diffPct != null && (
                        <span className={cn("text-xs tabular-nums", c.diffPct > 0 ? "text-amber-700 dark:text-amber-400" : "text-primary-600 dark:text-primary")}>
                          {c.diffPct > 0 ? "+" : ""}{formatPct(c.diffPct)}
                        </span>
                      )}
                      <span className="w-24 text-right font-medium tabular-nums text-foreground">{formatCurrency(c.spent)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </SectionCard>
            <SectionCard title="Dónde más gastaste" icon={Store} flush>
              <ul className="divide-y divide-border">
                {data.topPayees.map((p) => (
                  <li key={p.payee} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{p.payee}</span>
                    <span className="text-xs text-muted-foreground">{p.count} {p.count === 1 ? "vez" : "veces"}</span>
                    <span className="w-24 text-right font-medium tabular-nums text-foreground">{formatCurrency(p.spent)}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
            <SectionCard title="Los gastos más grandes" icon={Receipt} flush>
              <ul className="divide-y divide-border">
                {data.biggestExpenses.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{e.payee}</span>
                      <span className="block text-xs text-muted-foreground">{new Date(`${e.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long" })} · {e.categoryName}</span>
                    </span>
                    <span className="font-medium tabular-nums text-foreground">{formatCurrency(e.amount)}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
