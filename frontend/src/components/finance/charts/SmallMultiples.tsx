import { useMemo } from "react";
import type { FinanceAnalyticsMonthBucket } from "../../../lib/api";
import { formatCurrency, formatPct } from "../../../lib/format";
import { monthRange, transactionsHref } from "../../../lib/transaction-filters";
import { Sparkline } from "../../app/Sparkline";
import { ChartEmpty, paletteColor } from "../finance-ui";
import { cn } from "cn";

interface Props {
  /** Categoría → total por mes (analytics.monthlyCategories). */
  monthlyCategories: FinanceAnalyticsMonthBucket[];
  months: string[];
  metric: "expense" | "income";
  limit: number;
  accountId?: number;
  expanded: boolean;
}

/** Una tarjeta por categoría con su evolución mensual: se ve de un vistazo cuál sube, cuál baja y cuál es estable. */
export function SmallMultiples({ monthlyCategories, months, metric, limit, accountId, expanded }: Props) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const partial = months.length > 0 && months[months.length - 1] >= thisMonth;
  const cards = useMemo(() => {
    const byKey = new Map<string, { name: string; id: number | null; byMonth: Map<string, number> }>();
    for (const row of monthlyCategories) {
      if (row.type !== metric) continue;
      const entry = byKey.get(row.bucketKey) ?? { name: row.label, id: row.bucketId, byMonth: new Map<string, number>() };
      entry.byMonth.set(row.month, row.total);
      byKey.set(row.bucketKey, entry);
    }
    return [...byKey.entries()]
      .map(([key, e]) => {
        const values = months.map((m) => e.byMonth.get(m) ?? 0);
        const total = values.reduce((s, v) => s + v, 0);
        // El mes en curso se dibuja pero no cuenta como "último mes": comparar medio mes con meses completos engaña.
        const completeAll = partial ? values.slice(0, -1) : values;
        // Y desde el primer mes con datos de esa categoría: los meses anteriores a que existiera no son "gasto cero", son nada.
        const firstActive = completeAll.findIndex((v) => v > 0);
        const complete = firstActive < 0 ? [] : completeAll.slice(firstActive);
        const last = complete[complete.length - 1] ?? 0;
        const before = complete.slice(0, -1);
        const avgBefore = before.length ? before.reduce((s, v) => s + v, 0) / before.length : 0;
        return { key, name: e.name, id: e.id, values, total, last, avgBefore, change: avgBefore > 0 ? ((last - avgBefore) / avgBefore) * 100 : null };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }, [monthlyCategories, months, metric, limit, partial]);

  if (cards.length === 0 || months.length < 2) return <ChartEmpty message="No hay datos suficientes para esta selección." height={160} />;

  const lastMonth = months[months.length - 1];
  // En gastos, subir es malo; en ingresos, bueno.
  const badWhenUp = metric === "expense";

  return (
    <div className={cn("grid gap-3", expanded ? "sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {cards.map((c, i) => {
        const up = c.change !== null && c.change > 5;
        const down = c.change !== null && c.change < -5;
        const bad = (up && badWhenUp) || (down && !badWhenUp);
        const good = (down && badWhenUp) || (up && !badWhenUp);
        return (
          <a
            key={c.key}
            href={transactionsHref({
              ...(c.id === null ? { uncategorized: true } : { categoryId: c.id }),
              type: metric,
              cleared: "true",
              accountId,
              from: monthRange(months[0]).from,
              to: monthRange(lastMonth).to,
            })}
            className="group rounded-xl border border-border bg-card p-3.5 outline-none transition hover:border-foreground/25 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50"
            title={`Ver los movimientos de ${c.name}`}
          >
            <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{formatCurrency(c.total)}</p>
            <div className="mt-2 h-9">
              <Sparkline values={c.values} color={paletteColor(i)} className="h-full w-full" />
            </div>
            <p className={cn("mt-1.5 text-xs tabular-nums", bad ? "text-red-600 dark:text-red-400" : good ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
              {c.change === null ? "Sin media previa" : `${c.change > 0 ? "+" : ""}${formatPct(c.change)} ${partial ? "el último mes completo" : "el último mes"} vs. su media`}
            </p>
          </a>
        );
      })}
    </div>
  );
}
