import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getBudgetSummary } from "../../../lib/api";
import { buildBudgetBars, shiftMonth } from "../../../lib/analytics-charts";
import { formatCompact, formatCurrency } from "../../../lib/format";
import { ChartTooltip } from "../../ui/ChartTooltip";
import { chartAxis, chartCursor, chartGrid } from "../../app";
import { ChartEmpty, ChartLegend, shortenLabel } from "../finance-ui";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Lo presupuestado frente a lo gastado de cada categoría en un mes (en rojo, las que se han pasado). */
export function BudgetVsActualChart({ limit, expanded }: { limit: number; expanded: boolean }) {
  const [month, setMonth] = useState(currentMonth);
  const { data, isLoading } = useQuery({ queryKey: ["budgets", month], queryFn: () => getBudgetSummary(month) });
  const bars = useMemo(() => (data ? buildBudgetBars(data.groups, limit) : []), [data, limit]);
  const rows = bars.map((b) => ({ ...b, label: shortenLabel(b.name, expanded ? 24 : 14) }));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Mes anterior"><ChevronLeft className="size-4" /></Button>
          <span className="min-w-36 px-1 text-center text-sm font-medium capitalize text-foreground">{monthName(month)}</span>
          <Button variant="outline" size="icon-sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Mes siguiente"><ChevronRight className="size-4" /></Button>
        </div>
        <a href="/app/budget" className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Abrir presupuesto</a>
      </div>

      {isLoading ? (
        <div className={cn("animate-pulse rounded-lg bg-muted/50", expanded ? "h-96" : "h-72")} />
      ) : rows.length === 0 ? (
        <ChartEmpty message="No hay presupuesto ni gasto por categoría en este mes." height={expanded ? 380 : 280} />
      ) : (
        <>
          <div style={{ height: Math.max(expanded ? 380 : 260, rows.length * 38) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...chartGrid} horizontal={false} vertical />
                <XAxis type="number" {...chartAxis} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="label" {...chartAxis} width={expanded ? 150 : 96} />
                <Tooltip content={<ChartTooltip valueFormatter={formatCurrency} labelFormatter={(l) => String(rows.find((r) => r.label === l)?.name ?? l)} />} cursor={chartCursor} />
                <Bar dataKey="budget" name="Presupuesto" fill="var(--chart-4)" fillOpacity={0.55} radius={[0, 3, 3, 0]} maxBarSize={14} />
                <Bar dataKey="spent" name="Gastado" radius={[0, 3, 3, 0]} maxBarSize={14}>
                  {rows.map((r) => <Cell key={r.name} fill={r.over ? "#ef4444" : "var(--chart-1)"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend items={[{ color: "var(--chart-4)", label: "Presupuesto" }, { color: "var(--chart-1)", label: "Gastado" }, { color: "#ef4444", label: "Te has pasado" }]} />
        </>
      )}
    </div>
  );
}
