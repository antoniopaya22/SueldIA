import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Landmark } from "lucide-react";
import { getBalanceHistory } from "../../lib/api";
import { formatCompact, formatCurrency, formatMonthLabel } from "../../lib/format";
import { ChartTooltip } from "../ui/ChartTooltip";
import { SectionCard, Segmented, chartAxis, chartColors, chartCursor, chartGrid } from "../app";
import { ChartLegend, adaptiveColor, paletteColor } from "./finance-ui";

type View = "total" | "accounts";

/**
 * Saldo al final de cada mes. Sale del servidor calculado hacia delante desde
 * el saldo inicial de cada cuenta, así que no depende del filtro de periodo
 * del dashboard y el último punto es el saldo de hoy.
 */
export function BalanceHistoryCard({ accountId }: { accountId?: number }) {
  const [months, setMonths] = useState<"6" | "12" | "24">("12");
  const [view, setView] = useState<View>("total");

  const { data, isLoading } = useQuery({
    queryKey: ["balance-history", Number(months)],
    queryFn: () => getBalanceHistory(Number(months)),
  });

  const chart = useMemo(() => {
    if (!data) return null;
    const visible = data.accounts.filter((a) => (accountId ? a.id === accountId : !a.archived));
    const rows = data.months.map((month, i) => {
      const row: Record<string, number | string> = { label: formatMonthLabel(month) };
      for (const a of visible) row[`a${a.id}`] = a.series[i];
      row.total = accountId ? (visible[0]?.series[i] ?? 0) : data.total[i];
      return row;
    });
    const first = rows[0]?.total as number | undefined;
    const last = rows[rows.length - 1]?.total as number | undefined;
    return { rows, visible, change: first !== undefined && last !== undefined ? last - first : 0 };
  }, [data, accountId]);

  const description = chart
    ? `${chart.change >= 0 ? "+" : "−"}${formatCurrency(Math.abs(chart.change))} en ${months} meses`
    : "Saldo al final de cada mes";

  return (
    <SectionCard
      title="Evolución del saldo"
      description={description}
      icon={Landmark}
      action={
        <Segmented
          aria-label="Meses"
          value={months}
          onChange={setMonths}
          options={[{ value: "6", label: "6M" }, { value: "12", label: "12M" }, { value: "24", label: "24M" }]}
        />
      }
    >
      {isLoading || !chart ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
      ) : (
        <>
          {!accountId && (
            <div className="mb-3 flex justify-end">
              <Segmented
                aria-label="Vista"
                value={view}
                onChange={setView}
                options={[{ value: "total", label: "Total" }, { value: "accounts", label: "Cuentas" }]}
              />
            </div>
          )}
          {/* Más alto en escritorio: comparte fila con la previsión, que es más larga. */}
          <div className="h-64 lg:h-96">
            <ResponsiveContainer width="100%" height="100%">
              {view === "total" || accountId ? (
                <AreaChart data={chart.rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
                  <Area dataKey="total" name={accountId ? chart.visible[0]?.name ?? "Saldo" : "Saldo total"} type="monotone" stroke={chartColors.primary} fill={chartColors.primary} fillOpacity={0.14} strokeWidth={2} />
                </AreaChart>
              ) : (
                <LineChart data={chart.rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
                  {chart.visible.map((a, i) => (
                    <Line key={a.id} dataKey={`a${a.id}`} name={a.name} type="monotone" stroke={adaptiveColor(a.color, paletteColor(i))} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          {view === "accounts" && !accountId && (
            <ChartLegend items={chart.visible.map((a, i) => ({ color: adaptiveColor(a.color, paletteColor(i)), label: a.name }))} />
          )}
        </>
      )}
    </SectionCard>
  );
}
