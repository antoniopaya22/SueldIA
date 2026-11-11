import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarClock, Repeat } from "lucide-react";
import { getAccounts, getForecast } from "../../lib/api";
import { formatCompact, formatCurrency } from "../../lib/format";
import { ChartTooltip } from "../ui/ChartTooltip";
import { SectionCard, Segmented, chartAxis, chartColors, chartCursor, chartGrid } from "../app";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

// Con horizonte de un año, «10 nov» sería ambiguo: fuera del año en curso, con año.
const thisYear = String(new Date().getFullYear());
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", ...(date.slice(0, 4) !== thisYear ? { year: "2-digit" } : {}) });

const HORIZONS = [
  { value: "30", label: "30 días", long: "30 días" },
  { value: "90", label: "3 meses", long: "3 meses" },
  { value: "180", label: "6 meses", long: "6 meses" },
  { value: "365", label: "1 año", long: "12 meses" },
] as const;
type Horizon = (typeof HORIZONS)[number]["value"];

const selectClass = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";
const SHOWN = 6;

/**
 * Saldo previsto con lo que ya está programado (pendientes y recurrentes):
 * no adivina gastos futuros, solo proyecta lo conocido. Por cuenta o en
 * total, con horizonte a elegir y, en total, el escenario «si gasto lo
 * presupuestado».
 */
export function ForecastCard() {
  const [horizon, setHorizon] = useState<Horizon>("90");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [withBudget, setWithBudget] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const days = Number(horizon);
  const budget = withBudget && accountId === null;

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data, isLoading } = useQuery({
    queryKey: ["forecast", days, accountId, budget],
    queryFn: () => getForecast(days, { accountId, budget }),
    placeholderData: (prev) => prev,
  });
  const activeAccounts = accounts.filter((a) => !a.archived);
  const accountName = activeAccounts.find((a) => a.id === accountId)?.name;

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="forecast-account">Cuenta</label>
      <select
        id="forecast-account"
        className={selectClass}
        value={accountId ?? ""}
        onChange={(e) => { setAccountId(e.target.value ? Number(e.target.value) : null); setShowAll(false); }}
      >
        <option value="">Todas las cuentas</option>
        {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Segmented aria-label="Horizonte" value={horizon} onChange={(v) => { setHorizon(v); setShowAll(false); }} options={HORIZONS.map(({ value, label }) => ({ value, label }))} />
    </div>
  );

  if (isLoading || !data) {
    return (
      <SectionCard title="Previsión de saldo" description="Con lo que ya tienes programado" icon={CalendarClock}>
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
      </SectionCard>
    );
  }

  const scenario = data.scenario;
  const scenarioByDate = new Map(scenario?.points.map((p) => [p.date, p.balance]) ?? []);
  const rows = data.points.map((p) => ({ label: dayLabel(p.date), balance: p.balance, budget: scenarioByDate.get(p.date) ?? null, date: p.date }));
  const eomDelta = data.endOfMonth.balance - data.startBalance;
  const hasPlans = data.upcoming.length > 0;
  const lowestOverall = Math.min(data.lowest.balance, scenario?.lowest.balance ?? Infinity);
  const firstNegative = scenario?.firstNegative ?? data.firstNegative;
  const who = accountName ? `el saldo de ${accountName}` : "tu saldo total";
  const horizonLabel = HORIZONS.find((h) => h.value === horizon)!.long;
  const remainingThisMonth = scenario?.remainingByMonth[0]?.amount ?? 0;
  const upcoming = showAll ? data.upcoming : data.upcoming.slice(0, SHOWN);

  return (
    <SectionCard
      title="Previsión de saldo"
      description={`${accountName ?? "Todas las cuentas"} · próximos ${horizonLabel} con lo que ya tienes programado`}
      icon={CalendarClock}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {controls}
        {accountId === null && (
          <div className="flex items-center gap-2">
            <Switch id="forecast-budget" checked={withBudget} onCheckedChange={setWithBudget} />
            <Label htmlFor="forecast-budget" className="text-sm font-normal text-muted-foreground">Si gasto lo presupuestado</Label>
          </div>
        )}
      </div>

      {firstNegative && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-800 dark:text-red-300" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {scenario?.firstNegative && !data.firstNegative ? "Si gastas todo lo presupuestado, " : "Si no cambia nada, "}
            {who} quedaría en negativo a partir del <strong>{dayLabel(firstNegative)}</strong>.
          </span>
        </p>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">A fin de mes ({dayLabel(data.endOfMonth.date)})</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{formatCurrency(data.endOfMonth.balance)}</dd>
          <dd className={cn("text-xs tabular-nums", eomDelta < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {eomDelta === 0 ? "Sin cambios previstos" : `${eomDelta > 0 ? "+" : "−"}${formatCurrency(Math.abs(eomDelta))} frente a hoy`}
          </dd>
          {scenario && (
            <dd className="mt-1 text-xs tabular-nums text-muted-foreground">
              {formatCurrency(scenario.endOfMonth.balance)} gastando lo presupuestado
            </dd>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Punto más bajo</dt>
          <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", data.lowest.balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {formatCurrency(data.lowest.balance)}
          </dd>
          <dd className="text-xs text-muted-foreground">{data.lowest.balance === data.startBalance ? "Es el saldo de hoy" : `El ${dayLabel(data.lowest.date)}`}</dd>
          {scenario && (
            <dd className={cn("mt-1 text-xs tabular-nums", scenario.lowest.balance < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {formatCurrency(scenario.lowest.balance)} gastando lo presupuestado
            </dd>
          )}
        </div>
      </dl>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={36} />
            <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={["auto", "auto"]} />
            <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
            {lowestOverall < 0 && <ReferenceLine y={0} stroke={chartColors.expense} strokeDasharray="4 4" />}
            <Area dataKey="balance" name="Con lo programado" type="stepAfter" stroke={chartColors.secondary} fill={chartColors.secondary} fillOpacity={0.12} strokeWidth={2} />
            {scenario && (
              <Line dataKey="budget" name="Gastando lo presupuestado" type="monotone" stroke={chartColors.tax} strokeWidth={2} strokeDasharray="5 4" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {scenario && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="mr-1.5 inline-block h-0.5 w-4 align-middle" style={{ backgroundColor: chartColors.tax }} aria-hidden="true" />
          {remainingThisMonth > 0
            ? `Te quedan ${formatCurrency(remainingThisMonth)} de presupuesto este mes, repartidos hasta fin de mes; los meses siguientes repiten lo asignado.`
            : "Este mes ya no te queda presupuesto por gastar (o ya está todo programado)."}
        </p>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Próximos movimientos{hasPlans ? ` · ${data.upcoming.length}` : ""}
        </h3>
        {!hasPlans ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            No tienes nada programado. Programa tus pagos fijos como recurrentes para ver aquí cómo evoluciona tu saldo.{" "}
            <a href="/app/transactions?vista=recurrentes" className="font-medium text-foreground underline underline-offset-2">Programar</a>
          </p>
        ) : (
          <>
            <ul className={cn("divide-y divide-border", showAll && "max-h-96 overflow-y-auto pr-1")}>
              {upcoming.map((item, i) => (
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
            {data.upcoming.length > SHOWN && (
              <Button variant="ghost" size="sm" className="mt-2 w-full text-muted-foreground" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Ver menos" : `Ver los ${data.upcoming.length}`}
              </Button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
