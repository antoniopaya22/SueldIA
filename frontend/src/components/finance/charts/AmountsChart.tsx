import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getAmountDistribution } from "../../../lib/api";
import { formatCompact, formatCurrency } from "../../../lib/format";
import { ChartTooltip } from "../../ui/ChartTooltip";
import { chartAxis, chartBarCursor, chartGrid } from "../../app";
import { ChartEmpty } from "../finance-ui";
import { cn } from "cn";

interface Props {
  accountId?: number;
  groupId?: number;
  categoryId?: number;
  from: string;
  to: string;
  metric: "expense" | "income";
  view: "count" | "total";
  expanded: boolean;
}

const eur = (n: number) => `${n.toLocaleString("es-ES")} €`;
const short = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

/** Rótulos de los tramos a partir de sus límites: completos («5–10 €») para el tooltip y cortos («5–10») para el eje. */
function bucketLabels(edges: number[]): { full: string[]; short: string[] } {
  const last = edges[edges.length - 1];
  return {
    full: [`<${eur(edges[0])}`, ...edges.slice(1).map((e, i) => `${edges[i].toLocaleString("es-ES")}–${eur(e)}`), `≥${eur(last)}`],
    short: [`<${short(edges[0])}`, ...edges.slice(1).map((e, i) => `${short(edges[i])}–${short(e)}`), `≥${short(last)}`],
  };
}

/** ¿Muchos gastos pequeños o pocos grandes? Cuántos movimientos (o cuánto dinero) hay en cada tramo de importe. */
export function AmountsChart({ accountId, groupId, categoryId, from, to, metric, view, expanded }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["finance-amounts", from, to, accountId, groupId, categoryId],
    queryFn: () => getAmountDistribution({ from: from || undefined, to: to || undefined, accountId, groupId, categoryId }),
  });

  if (isLoading || !data) return <div className={cn("animate-pulse rounded-lg bg-muted/50", expanded ? "h-96" : "h-72")} />;
  const buckets = metric === "expense" ? data.expense : data.income;
  if (buckets.every((b) => b.count === 0)) return <ChartEmpty message="No hay movimientos en este periodo." height={expanded ? 380 : 280} />;

  const labels = bucketLabels(data.edges);
  const rows = buckets.map((b, i) => ({ label: labels.short[i], full: labels.full[i], count: b.count, total: b.total }));
  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  // Tramo donde está la mediana de los movimientos: el "importe típico".
  let acc = 0;
  const medianIndex = buckets.findIndex((b) => (acc += b.count) >= totalCount / 2);

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        {totalCount.toLocaleString("es-ES")} {totalCount === 1 ? "movimiento" : "movimientos"}; la mitad, de {labels.full[medianIndex]} o menos. Eje en euros.
      </p>
      <div className={expanded ? "h-96" : "h-64"}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval={0} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} angle={expanded ? 0 : -35} textAnchor={expanded ? "middle" : "end"} height={expanded ? 30 : 52} />
            <YAxis {...chartAxis} tickFormatter={view === "count" ? (v: number) => String(v) : formatCompact} width={48} allowDecimals={false} />
            <Tooltip
              cursor={chartBarCursor}
              content={
                <ChartTooltip
                  valueFormatter={view === "count" ? (v) => `${v} mov.` : formatCurrency}
                  labelFormatter={(l) => rows.find((r) => r.label === l)?.full ?? String(l)}
                />
              }
            />
            <Bar
              dataKey={view}
              name={view === "count" ? "Movimientos" : "Importe"}
              fill={metric === "expense" ? "var(--chart-2)" : "var(--chart-1)"}
              radius={[4, 4, 0, 0]}
              maxBarSize={44}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
