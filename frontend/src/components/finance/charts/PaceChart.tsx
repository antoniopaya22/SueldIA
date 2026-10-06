import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDailySeries } from "../../../lib/api";
import { buildPace, shiftMonth } from "../../../lib/analytics-charts";
import { formatCompact, formatCurrency, formatPct } from "../../../lib/format";
import { ChartTooltip } from "../../ui/ChartTooltip";
import { chartAxis, chartColors, chartCursor, chartGrid } from "../../app";
import { ChartEmpty, ChartLegend } from "../finance-ui";
import { cn } from "cn";

interface Props {
  accountId?: number;
  groupId?: number;
  categoryId?: number;
  expanded: boolean;
}

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Gasto acumulado de este mes día a día, frente al mes pasado y a la media de
 * los tres anteriores, con la proyección a fin de mes si sigues a este ritmo.
 * Respeta cuenta/grupo/categoría pero no el periodo de la página: siempre
 * habla del mes en curso.
 */
export function PaceChart({ accountId, groupId, categoryId, expanded }: Props) {
  const today = localIso(new Date());
  const from = `${shiftMonth(today.slice(0, 7), -3)}-01`;
  const { data: daily, isLoading } = useQuery({
    queryKey: ["finance-daily", "pace", today, accountId, groupId, categoryId],
    queryFn: () => getDailySeries({ from, to: today, accountId, groupId, categoryId }),
  });
  const pace = useMemo(() => (daily ? buildPace(daily, today) : null), [daily, today]);

  if (isLoading || !pace) return <div className={cn("animate-pulse rounded-lg bg-muted/50", expanded ? "h-96" : "h-72")} />;
  const { summary } = pace;
  if (!daily?.some((d) => d.expense > 0)) {
    return <ChartEmpty message="Aún no hay gasto liquidado en los últimos meses con estos filtros." height={expanded ? 380 : 280} />;
  }

  const ahead = summary.diff !== null && summary.diff > 0;
  return (
    <div>
      <p className="mb-4 text-sm text-foreground">
        Llevas <strong className="tabular-nums">{formatCurrency(summary.spent)}</strong> gastados este mes
        {summary.diff !== null && summary.previousSameDay !== null && (
          <>
            {" "}— <span className={cn("font-medium tabular-nums", ahead ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
              {formatCurrency(Math.abs(summary.diff))} {ahead ? "más" : "menos"}
              {summary.diffPct !== null && ` (${summary.diffPct > 0 ? "+" : ""}${formatPct(summary.diffPct)})`}
            </span>{" "}
            que el mes pasado a estas alturas.
          </>
        )}
      </p>

      <dl className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          ["Mes pasado, a día " + summary.today, summary.previousSameDay],
          ["Si sigues a este ritmo", summary.projectedEnd],
          ["Media de 3 meses (completo)", summary.averageTotal],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground sm:text-base">{value === null ? "—" : formatCurrency(value as number)}</dd>
          </div>
        ))}
      </dl>

      <div className={expanded ? "h-96" : "h-64"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pace.rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="day" {...chartAxis} interval={4} tickFormatter={(d) => String(d)} />
            <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
            <Tooltip content={<ChartTooltip labelFormatter={(d) => `Día ${d}`} />} cursor={chartCursor} />
            <Line dataKey="average" name="Media 3 meses" stroke={chartColors.quaternary} strokeWidth={1.75} strokeDasharray="2 4" dot={false} connectNulls />
            <Line dataKey="previous" name="Mes pasado" stroke={chartColors.secondary} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
            <Line dataKey="projection" name="Proyección" stroke={chartColors.tax} strokeWidth={2} strokeDasharray="3 3" dot={false} connectNulls />
            <Line dataKey="current" name="Este mes" stroke={chartColors.primary} strokeWidth={3} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={[
          { color: chartColors.primary, label: "Este mes", line: true },
          { color: chartColors.secondary, label: "Mes pasado", line: true },
          { color: chartColors.quaternary, label: "Media 3 meses", line: true },
          { color: chartColors.tax, label: "Proyección", line: true },
        ]}
      />
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        La proyección es lineal (lo gastado hasta hoy, repartido por los días del mes): un gasto grande a principios de mes, como el alquiler, la infla.
      </p>
    </div>
  );
}
