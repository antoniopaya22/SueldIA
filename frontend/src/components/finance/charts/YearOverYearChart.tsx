import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getFinanceTrends } from "../../../lib/api";
import { buildYearOverYear, shiftMonth } from "../../../lib/analytics-charts";
import { formatCompact } from "../../../lib/format";
import { ChartTooltip } from "../../ui/ChartTooltip";
import { chartAxis, chartCursor, chartGrid } from "../../app";
import { ChartEmpty, ChartLegend, paletteColor } from "../finance-ui";
import { cn } from "cn";

interface Props {
  accountId?: number;
  groupId?: number;
  categoryId?: number;
  metric: "expenses" | "income" | "savings";
  expanded: boolean;
}

const METRIC_NAME = { expenses: "Gastos", income: "Ingresos", savings: "Ahorro" } as const;
const localMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Cada año como una línea sobre los mismos 12 meses: ¿gastas más que hace un año por estas fechas? */
export function YearOverYearChart({ accountId, groupId, categoryId, metric, expanded }: Props) {
  // Solo meses completos: el mes en curso, a medias, parecería una caída que no es.
  const lastMonth = shiftMonth(localMonth(), -1);
  // Los últimos 3 años naturales, con independencia del periodo de la página.
  const from = `${Number(localMonth().slice(0, 4)) - 2}-01-01`;
  const { data: trends, isLoading } = useQuery({
    queryKey: ["finance-trends", "yoy", from, accountId, groupId, categoryId],
    queryFn: () => getFinanceTrends({ from, accountId, groupId, categoryId }),
  });
  const yoy = useMemo(() => (trends ? buildYearOverYear(trends, metric, lastMonth) : null), [trends, metric, lastMonth]);

  if (isLoading || !yoy) return <div className={cn("animate-pulse rounded-lg bg-muted/50", expanded ? "h-96" : "h-72")} />;
  if (yoy.years.length === 0) return <ChartEmpty message="Aún no hay movimientos liquidados." height={expanded ? 380 : 280} />;
  if (yoy.years.length === 1) {
    return <ChartEmpty message="Hace falta más de un año de historial para comparar un año con otro." height={expanded ? 380 : 280} />;
  }

  const lastYear = yoy.years[yoy.years.length - 1];
  return (
    <div>
      <div className={expanded ? "h-96" : "h-64"}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={yoy.rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval={0} padding={{ left: 8, right: 14 }} />
            <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
            <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
            {yoy.years.map((year, i) => (
              <Line
                key={year}
                dataKey={year}
                name={`${METRIC_NAME[metric]} ${year}`}
                stroke={year === lastYear ? "var(--chart-1)" : paletteColor(i + 1)}
                strokeWidth={year === lastYear ? 3 : 1.75}
                strokeOpacity={year === lastYear ? 1 : 0.8}
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={yoy.years.map((year, i) => ({ color: year === lastYear ? "var(--chart-1)" : paletteColor(i + 1), label: year, line: true }))} />
    </div>
  );
}
