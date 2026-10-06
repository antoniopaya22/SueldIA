import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarClock, Repeat } from "lucide-react";
import { getForecast } from "../../lib/api";
import { formatCompact, formatCurrency } from "../../lib/format";
import { ChartTooltip } from "../ui/ChartTooltip";
import { SectionCard, chartAxis, chartColors, chartCursor, chartGrid } from "../app";
import { cn } from "cn";

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

/**
 * Saldo previsto con lo que ya está programado (pendientes y recurrentes):
 * no adivina gastos futuros, solo proyecta lo conocido.
 */
export function ForecastCard() {
  const { data, isLoading } = useQuery({ queryKey: ["forecast", 90], queryFn: () => getForecast(90) });

  if (isLoading || !data) {
    return (
      <SectionCard title="Previsión de saldo" description="Con lo que ya tienes programado" icon={CalendarClock}>
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
      </SectionCard>
    );
  }

  const rows = data.points.map((p) => ({ label: dayLabel(p.date), balance: p.balance, date: p.date }));
  const eomDelta = data.endOfMonth.balance - data.startBalance;
  const hasPlans = data.upcoming.length > 0;

  return (
    <SectionCard
      title="Previsión de saldo"
      description="Próximos 90 días con lo que ya tienes programado"
      icon={CalendarClock}
    >
      {data.firstNegative && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-800 dark:text-red-300" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Si no cambia nada, tu saldo total quedaría en negativo a partir del <strong>{dayLabel(data.firstNegative)}</strong>.</span>
        </p>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">A fin de mes ({dayLabel(data.endOfMonth.date)})</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{formatCurrency(data.endOfMonth.balance)}</dd>
          <dd className={cn("text-xs tabular-nums", eomDelta < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {eomDelta === 0 ? "Sin cambios previstos" : `${eomDelta > 0 ? "+" : "−"}${formatCurrency(Math.abs(eomDelta))} frente a hoy`}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Punto más bajo</dt>
          <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", data.lowest.balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {formatCurrency(data.lowest.balance)}
          </dd>
          <dd className="text-xs text-muted-foreground">{data.lowest.balance === data.startBalance ? "Es el saldo de hoy" : `El ${dayLabel(data.lowest.date)}`}</dd>
        </div>
      </dl>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={36} />
            <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={["auto", "auto"]} />
            <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
            {data.lowest.balance < 0 && <ReferenceLine y={0} stroke={chartColors.expense} strokeDasharray="4 4" />}
            <Area dataKey="balance" name="Saldo previsto" type="stepAfter" stroke={chartColors.secondary} fill={chartColors.secondary} fillOpacity={0.12} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Próximos movimientos</h3>
        {!hasPlans ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            No tienes nada programado. Programa tus pagos fijos como recurrentes para ver aquí cómo evoluciona tu saldo.{" "}
            <a href="/app/transactions" className="font-medium text-foreground underline underline-offset-2">Programar</a>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.upcoming.slice(0, 6).map((item, i) => (
              <li key={`${item.date}-${item.payee}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{item.overdue ? "Atrasado" : dayLabel(item.date)}</span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-foreground">{item.payee}</span>
                  {item.source === "recurring" && <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Recurrente" />}
                </span>
                <span className={cn("shrink-0 font-medium tabular-nums", item.amount > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                  {item.amount > 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
