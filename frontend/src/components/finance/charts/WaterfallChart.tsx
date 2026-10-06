import { useMemo } from "react";
import { Bar, BarChart, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildWaterfall, type WaterfallStep } from "../../../lib/analytics-charts";
import { formatCompact, formatCurrency } from "../../../lib/format";
import { chartAxis, chartCursor, chartGrid } from "../../app";
import { ChartEmpty, shortenLabel } from "../finance-ui";

interface Props {
  income: number;
  groups: { name: string; total: number }[];
  limit: number;
  expanded: boolean;
}

const fillFor = (step: WaterfallStep) =>
  step.kind === "income" ? "#16a34a" : step.kind === "expense" ? "#ef4444" : step.value >= 0 ? "var(--chart-1)" : "#b91c1c";

/** Cascada: lo que entra, lo que se lleva cada grupo de gasto y lo que queda (o lo que falta). */
export function WaterfallChart({ income, groups, limit, expanded }: Props) {
  const steps = useMemo(() => buildWaterfall(income, groups, limit), [income, groups, limit]);
  if (income <= 0 && groups.every((g) => g.total <= 0)) {
    return <ChartEmpty message="No hay ingresos ni gastos en este periodo." height={expanded ? 380 : 280} />;
  }
  return (
    <div className={expanded ? "h-96" : "h-72"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={steps} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="name" {...chartAxis} interval={0} tickFormatter={(v: string) => shortenLabel(v, expanded ? 16 : 9)} />
          <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip
            cursor={chartCursor}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const step = payload[0].payload as WaterfallStep;
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <p className="font-medium text-foreground">{step.name}</p>
                  <p className="mt-0.5 tabular-nums text-muted-foreground">
                    {step.kind === "expense" ? "−" : step.kind === "income" ? "+" : ""}{formatCurrency(Math.abs(step.value))}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="range" radius={[3, 3, 3, 3]} maxBarSize={56}>
            {steps.map((step) => <Cell key={step.name} fill={fillFor(step)} fillOpacity={0.9} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
