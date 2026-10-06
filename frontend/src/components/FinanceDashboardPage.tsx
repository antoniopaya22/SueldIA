import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarRange, Download, PiggyBank, RefreshCcw, Wallet,
} from "lucide-react";
import { getAccounts, getFinanceAnalytics, type FinanceAnalyticsFilters } from "../lib/api";
import { monthRange, transactionsHref } from "../lib/transaction-filters";
import { formatCompact, formatCurrency, formatMonthLabel, formatPct } from "../lib/format";
import { Providers } from "./Providers";
import { EmptyState } from "./ui/EmptyState";
import { ChartTooltip } from "./ui/ChartTooltip";
import {
  PageHeader, StatCard, StatGrid, SectionCard, ChartCard, CardLink, Segmented,
  PageHeaderSkeleton, StatCardSkeleton, ChartCardSkeleton, ListCardSkeleton,
  chartAxis, chartGrid, chartBarCursor, chartColors, type StatDelta,
} from "./app";
import {
  AccountSelect, ChartLegend, PieTooltip, RankedList, adaptiveColor, flowColors, paletteColor, presetRange, PRESET_LABELS,
  shortenLabel, type RangePreset,
} from "./finance/finance-ui";
import { BalanceHistoryCard } from "./finance/BalanceHistoryCard";
import { ForecastCard } from "./finance/ForecastCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

type Preset = Extract<RangePreset, "3m" | "6m" | "12m" | "all">;

const PRESET_OPTIONS: Array<{ value: Preset; label: string }> = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
  { value: "all", label: "Todo" },
];

/** Variación del último mes frente al anterior (solo meses con actividad). */
function lastMonthDelta(series: number[], invert = false): StatDelta | undefined {
  if (series.length < 2) return undefined;
  const [prev, last] = series.slice(-2);
  if (!prev) return undefined;
  const change = ((last - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(change)) return undefined;
  const trend = Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down";
  const tone = trend === "flat" ? "neutral" : (trend === "up") !== invert ? "positive" : "negative";
  return { value: `${change > 0 ? "+" : ""}${formatPct(change)}`, trend, tone, label: "último mes" };
}

function FinanceSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </StatGrid>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ChartCardSkeleton className="lg:col-span-2" height={280} />
        <ListCardSkeleton rows={5} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ListCardSkeleton rows={5} />
        <ListCardSkeleton rows={5} />
      </div>
    </div>
  );
}

function FinanceDashboardView() {
  const [preset, setPreset] = useState<Preset>("6m");
  const [accountId, setAccountId] = useState<number | undefined>();

  const filters = useMemo<FinanceAnalyticsFilters>(() => {
    const range = presetRange(preset);
    return { from: range.from || undefined, to: range.to || undefined, accountId };
  }, [preset, accountId]);

  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: analytics, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["finance-dashboard", filters],
    queryFn: () => getFinanceAnalytics(filters),
  });

  const derived = useMemo(() => {
    const monthly = (analytics?.monthly ?? []).map((m) => ({ ...m, label: formatMonthLabel(m.month) }));
    const active = monthly.filter((m) => m.income > 0 || m.expenses > 0);

    // Saldo al final de cada mes, reconstruido hacia atrás desde el saldo actual.
    let running = (analytics?.summary.totalBalance ?? 0) - monthly.reduce((s, m) => s + m.net, 0);
    const balanceSeries = monthly.map((m) => (running += m.net));

    const expenseCategories = (analytics?.categories ?? []).filter((c) => c.type === "expense");
    const expenseTotal = expenseCategories.reduce((s, c) => s + c.total, 0);
    const topCategories = expenseCategories.slice(0, 6);
    const otherTotal = expenseCategories.slice(6).reduce((s, c) => s + c.total, 0);
    const categorySlices = [
      ...topCategories.map((c, i) => ({
        key: c.bucketKey,
        label: c.categoryName,
        group: c.groupName,
        value: c.total,
        color: paletteColor(i),
        // El dashboard solo cuenta lo liquidado: el enlace filtra igual para que el total coincida.
        href: transactionsHref({
          ...(c.categoryId === null ? { uncategorized: true } : { categoryId: c.categoryId }),
          type: "expense", from: filters.from, to: filters.to, accountId, cleared: "true",
        }),
      })),
      ...(otherTotal > 0 ? [{ key: "__other", label: "Otras", group: "", value: otherTotal, color: "var(--muted-foreground)", href: undefined as string | undefined }] : []),
    ];

    const payees = (analytics?.payees ?? [])
      .filter((p) => p.type === "expense")
      .slice(0, 7)
      .map((p) => ({
        ...p,
        href: p.payee === "Sin beneficiario"
          ? undefined
          : transactionsHref({ search: p.payee, type: "expense", from: filters.from, to: filters.to, accountId, cleared: "true" }),
      }));

    return {
      monthly,
      balanceSeries,
      incomeSeries: active.map((m) => m.income),
      expenseSeries: active.map((m) => m.expenses),
      categorySlices,
      expenseTotal,
      payees,
    };
  }, [analytics, filters, accountId]);

  if (isLoading || loadingAccounts) return <FinanceSkeleton />;

  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudo cargar el resumen financiero" description="Vuelve a intentarlo en unos segundos.">
        <Button onClick={() => refetch()} className="gap-1.5">
          <RefreshCcw className="size-4" /> Reintentar
        </Button>
      </EmptyState>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Tus finanzas," accent="de un vistazo." description="Saldo, flujo mensual y focos de gasto de todas tus cuentas." />
        <EmptyState
          icon={Wallet}
          title="Aún no hay datos financieros"
          description="Importa tu CSV de YNAB o crea una cuenta para ver tu saldo, ingresos y gastos."
          actionLabel="Importar datos"
          actionHref="/app/import"
          actionIcon={Download}
        >
          <a href="/app/accounts" className={buttonVariants({ variant: "outline" })}>Crear cuenta</a>
        </EmptyState>
      </>
    );
  }

  if (!analytics) return null;

  // Pulsar una barra lleva a los movimientos (liquidados, como en el gráfico) de ese mes.
  const openMonth = (bar: { month?: string }) => {
    if (bar.month) window.location.href = transactionsHref({ ...monthRange(bar.month), accountId, cleared: "true" });
  };

  const { summary } = analytics;
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const hasTransactions = summary.transactionCount > 0;
  const lastBalances = derived.balanceSeries;

  const header = (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="size-3.5" />
          {isFetching ? "Actualizando…" : `${PRESET_LABELS[preset]} · ${selectedAccount?.name ?? "Todas las cuentas"}`}
        </span>
      }
      title="Tus finanzas,"
      accent="de un vistazo."
      description="Saldo, flujo mensual y focos de gasto. Para explorar a fondo, abre la analítica."
      actions={
        <>
          <Segmented aria-label="Periodo" value={preset} onChange={setPreset} options={PRESET_OPTIONS} />
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
          <a href="/app/finance/analytics" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 bg-card")}>
            Analítica <ArrowRight className="size-3.5" />
          </a>
        </>
      }
    />
  );

  return (
    <div>
      {header}

      <StatGrid>
        <StatCard
          label="Saldo actual"
          value={formatCurrency(summary.totalBalance)}
          icon={Wallet}
          hint={selectedAccount ? selectedAccount.name : `${accounts.filter((a) => !a.archived).length} cuentas`}
          sparkline={lastBalances.length > 2 ? lastBalances : undefined}
          emphasis
        />
        <StatCard
          label="Ingresos del periodo"
          value={formatCurrency(summary.incomeTotal)}
          icon={ArrowUpRight}
          delta={lastMonthDelta(derived.incomeSeries)}
          hint={`Media ${formatCurrency(summary.monthlyAverageIncome)}/mes`}
          sparkline={derived.incomeSeries.length > 2 ? derived.incomeSeries : undefined}
          sparklineColor={flowColors.income}
        />
        <StatCard
          label="Gastos del periodo"
          value={formatCurrency(summary.expenseTotal)}
          icon={ArrowDownRight}
          delta={lastMonthDelta(derived.expenseSeries, true)}
          hint={summary.topExpenseMonth ? `Pico en ${formatMonthLabel(summary.topExpenseMonth.month)}` : `Media ${formatCurrency(summary.monthlyAverageExpenses)}/mes`}
          sparkline={derived.expenseSeries.length > 2 ? derived.expenseSeries : undefined}
          sparklineColor={flowColors.expense}
        />
        <StatCard
          label="Tasa de ahorro"
          value={summary.incomeTotal > 0 ? formatPct(summary.savingsRate) : "—"}
          icon={PiggyBank}
          delta={
            summary.netTotal !== 0
              ? { value: formatCurrency(summary.netTotal), trend: summary.netTotal > 0 ? "up" : "down", label: "de flujo neto" }
              : undefined
          }
          hint={summary.netTotal === 0 ? "Sin flujo neto en el periodo" : undefined}
        />
      </StatGrid>

      {!hasTransactions ? (
        <EmptyState
          className="mt-6"
          icon={CalendarRange}
          title="Sin movimientos en este periodo"
          description="Prueba con un periodo más amplio o con otra cuenta."
        >
          <Button variant="outline" onClick={() => { setPreset("all"); setAccountId(undefined); }}>Ver todo el histórico</Button>
        </EmptyState>
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <ChartCard
              className="lg:col-span-2"
              title="Flujo mensual"
              description="Ingresos, gastos y ahorro de cada mes. Pulsa una barra para ver sus movimientos."
              action={<CardLink href="/app/finance/analytics">Ver más</CardLink>}
              height={316}
              legend={
                <ChartLegend
                  items={[
                    { color: flowColors.income, label: "Ingresos" },
                    { color: flowColors.expense, label: "Gastos" },
                    { color: flowColors.net, label: "Ahorro", line: true },
                  ]}
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={derived.monthly} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
                  <Tooltip content={<ChartTooltip />} cursor={chartBarCursor} />
                  <Bar dataKey="income" name="Ingresos" fill={flowColors.income} radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={openMonth} />
                  <Bar dataKey="expenses" name="Gastos" fill={flowColors.expense} fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={22} cursor="pointer" onClick={openMonth} />
                  <Line dataKey="net" name="Ahorro" type="monotone" stroke={flowColors.net} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <SectionCard title="Gasto por categoría" description="Qué pesa más en el periodo">
              {derived.categorySlices.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No hay gasto categorizado en este periodo.</p>
              ) : (
                <>
                  <div className="relative mx-auto h-40 w-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={derived.categorySlices} dataKey="value" nameKey="label" innerRadius={52} outerRadius={76} paddingAngle={2} strokeWidth={0}>
                          {derived.categorySlices.map((s) => <Cell key={s.key} fill={s.color} />)}
                        </Pie>
                        <Tooltip content={<PieTooltip format={formatCurrency} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[11px] text-muted-foreground">Gasto</span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">{formatCompact(derived.expenseTotal)}</span>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2">
                    {derived.categorySlices.map((s) => (
                      <li key={s.key} className="flex items-center gap-2 text-sm">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.href ? (
                          <a href={s.href} className="min-w-0 flex-1 truncate rounded-sm text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50" title={`Ver movimientos de ${s.group ? `${s.label} · ${s.group}` : s.label}`}>{s.label}</a>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                        )}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {derived.expenseTotal > 0 ? formatPct((s.value / derived.expenseTotal) * 100) : "—"}
                        </span>
                        <span className="w-20 text-right font-medium tabular-nums text-foreground">{formatCurrency(s.value)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <SectionCard title="Dónde se va el dinero" description="Beneficiarios con más gasto" action={<CardLink href="/app/transactions">Movimientos</CardLink>}>
              {derived.payees.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No hay beneficiarios con gasto en este periodo.</p>
              ) : (
                <RankedList
                  format={formatCurrency}
                  items={derived.payees.map((p, i) => ({
                    key: p.bucketKey,
                    label: shortenLabel(p.payee, 28),
                    href: p.href,
                    value: p.total,
                    color: i === 0 ? flowColors.expense : chartColors.quaternary,
                    meta: `${p.count} mov.`,
                  }))}
                />
              )}
            </SectionCard>

            <SectionCard title="Cuentas" description="Saldo y flujo del periodo" action={<CardLink href="/app/accounts">Gestionar</CardLink>} flush>
              <ul className="divide-y divide-border">
                {analytics.accounts.slice(0, 6).map((a) => (
                  <li key={a.accountId} className="flex items-center gap-3 px-5 py-3">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: adaptiveColor(a.color, chartColors.secondary) }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        <a href={transactionsHref({ accountId: a.accountId })} className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50" title={`Ver movimientos de ${a.accountName}`}>{a.accountName}</a>
                      </p>
                      <p className="truncate text-xs text-muted-foreground tabular-nums">
                        <span className={a.income > 0 ? "text-emerald-700 dark:text-emerald-400" : undefined}>{a.income > 0 ? "+" : ""}{formatCurrency(a.income)}</span>
                        {" · "}
                        <span>{a.expenses > 0 ? "−" : ""}{formatCurrency(a.expenses)}</span>
                        {" · "}
                        {a.transactionCount} mov.
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-semibold tabular-nums", a.balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                        {formatCurrency(a.balance)}
                      </p>
                      <p className={cn("text-xs tabular-nums", a.net > 0 ? "text-emerald-700 dark:text-emerald-400" : a.net < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                        {a.net > 0 ? "+" : ""}{formatCurrency(a.net)} neto
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>
        </>
      )}

      {/* No dependen del periodo elegido arriba: el saldo es el de cada fin de mes y la previsión mira hacia delante. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BalanceHistoryCard accountId={accountId} />
        <ForecastCard />
      </div>
    </div>
  );
}

export default function FinanceDashboardPage() {
  return (
    <Providers>
      <FinanceDashboardView />
    </Providers>
  );
}
