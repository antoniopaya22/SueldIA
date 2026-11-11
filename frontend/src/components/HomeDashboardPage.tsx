import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, ArrowLeftRight, CreditCard, Download, FileText,
  Landmark, PiggyBank, Plus, Receipt, TrendingUp, Upload, Users, Wallet, Banknote, CircleDollarSign,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import {
  getDashboard, getFinanceSummary, getFinanceTrends, getAccounts, getTransactions, getPayslips, getPayslip, getMe,
  type Transaction, type Account,
} from "../lib/api";
import { Providers } from "./Providers";
import { formatCurrency, formatCompact, formatMonthLabel, formatPct } from "../lib/format";
import { ChartTooltip } from "./ui/ChartTooltip";
import { EmptyState } from "./ui/EmptyState";
import {
  PageHeader, StatCard, StatGrid, SectionCard, ChartCard, CardLink,
  PageHeaderSkeleton, StatCardSkeleton, ChartCardSkeleton, ListCardSkeleton,
  chartAxis, chartGrid, chartColors, chartBarCursor, DeltaBadge, type StatDelta,
} from "./app";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { getTodayIsoDate } from "./finance-manage/transactions/shared";

// ─── Helpers ────────────────────────────────────────────────────
const MONTHS_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 7) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

function todayLabel(): string {
  const s = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function pctDelta(current: number, previous: number | undefined, label: string, invert = false): StatDelta | undefined {
  if (previous == null || previous === 0) return undefined;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change)) return undefined;
  const trend = Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down";
  const good = trend === "flat" ? "neutral" : (trend === "up") !== invert ? "positive" : "negative";
  return { value: `${change > 0 ? "+" : ""}${formatPct(change)}`, trend, tone: good, label };
}

const ACCOUNT_ICONS: Record<Account["type"], LucideIcon> = {
  bank: Landmark,
  credit_card: CreditCard,
  cash: Banknote,
  investment: TrendingUp,
  other: Wallet,
};

// ─── Skeleton ───────────────────────────────────────────────────
function HomeSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </StatGrid>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ChartCardSkeleton className="lg:col-span-2" height={260} />
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  );
}

// ─── Bienvenida (sin datos) ─────────────────────────────────────
const ONBOARDING_STEPS = [
  { icon: Users, title: "Crea un perfil", text: "Una persona por perfil: tú, tu pareja… cada uno con su histórico.", href: "/app/profiles", cta: "Crear perfil" },
  { icon: Upload, title: "Sube tus nóminas", text: "Arrastra los PDF y extraemos bruto, neto, IRPF y cada concepto.", href: "/app/upload", cta: "Subir nóminas" },
  { icon: Download, title: "Conecta tus finanzas", text: "Importa tu CSV de YNAB o crea cuentas para ver gastos e ingresos.", href: "/app/import", cta: "Importar datos" },
];

function Onboarding({ firstName }: { firstName?: string }) {
  return (
    <div>
      <PageHeader
        eyebrow={todayLabel()}
        title={firstName ? `Hola, ${firstName}.` : "Hola."}
        accent="Empecemos."
        description="Tres pasos y tendrás tus nóminas y tus finanzas explicadas en un mismo sitio."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {ONBOARDING_STEPS.map((step, i) => (
          <a
            key={step.href}
            href={step.href}
            className="group relative flex flex-col rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
          >
            <span className="absolute top-5 right-5 font-serif-accent text-3xl text-muted-foreground/30">0{i + 1}</span>
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-primary/10">
              <step.icon className="size-5 text-primary-600 dark:text-primary" />
            </div>
            <h3 className="mt-5 font-semibold text-foreground">{step.title}</h3>
            <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{step.text}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 dark:text-primary">
              {step.cta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Tarjetas ───────────────────────────────────────────────────
function TransactionRow({ tx }: { tx: Transaction }) {
  const isExpense = tx.type === "expense";
  const isIncome = tx.type === "income";
  const Icon = isExpense ? ArrowDownRight : isIncome ? ArrowUpRight : ArrowLeftRight;
  return (
    <li className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          isExpense ? "bg-red-500/10 text-red-600 dark:text-red-400" : isIncome ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{tx.payee ?? tx.accountName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {shortDate(tx.date)}
          {tx.categoryName ? ` · ${tx.categoryName}` : tx.type === "transfer" ? ` · Traspaso a ${tx.targetAccountName}` : ""}
        </p>
      </div>
      <p className={cn("text-sm font-medium tabular-nums", isExpense ? "text-foreground" : isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {isExpense ? "−" : isIncome ? "+" : ""}
        {formatCurrency(tx.amount)}
      </p>
    </li>
  );
}

function LatestPayslipCard({ payslipId, previousNet }: { payslipId: number; previousNet?: number }) {
  const { data: payslip, isLoading } = useQuery({
    queryKey: ["payslip", payslipId],
    queryFn: () => getPayslip(payslipId),
  });

  if (isLoading || !payslip) return <ListCardSkeleton rows={3} />;

  const gross = payslip.grossSalary ?? 0;
  const net = payslip.netSalary ?? 0;
  const deductions = payslip.concepts.filter((c) => c.category === "deduccion");
  const irpf = deductions.filter((c) => c.name.toLowerCase().includes("irpf")).reduce((s, c) => s + c.amount, 0);
  const other = Math.max(gross - net - irpf, 0);
  const segments = [
    { label: "Neto", value: net, className: "bg-primary-500 dark:bg-primary" },
    { label: "IRPF", value: irpf, className: "bg-amber-400" },
    { label: "Seg. Social y otros", value: other, className: "bg-brand-navy/70 dark:bg-slate-500" },
  ];
  const period = payslip.periodMonth && payslip.periodYear ? `${MONTHS_FULL[payslip.periodMonth - 1]} ${payslip.periodYear}` : "Sin periodo";
  const delta = pctDelta(net, previousNet, "vs. mes anterior");

  return (
    <SectionCard title="Tu última nómina" description={payslip.company ?? undefined} action={<CardLink href="/app/payslips">Ver todas</CardLink>}>
      <p className="text-xs font-medium capitalize text-muted-foreground">{period}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{formatCurrency(net)}</p>
        <span className="text-sm text-muted-foreground">neto</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        de <span className="tabular-nums">{formatCurrency(gross)}</span> brutos
        {gross > 0 && <> · te llega el <span className="font-medium text-foreground tabular-nums">{formatPct((net / gross) * 100)}</span></>}
      </p>
      {delta && (
        <div className="mt-3">
          <DeltaBadge delta={delta} />
        </div>
      )}
      <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Reparto del bruto">
        {segments.map((s) => (
          <div key={s.label} className={cn("h-full first:rounded-l-full last:rounded-r-full", s.className)} style={{ width: `${gross ? (s.value / gross) * 100 : 0}%` }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", s.className)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">{formatCurrency(s.value)}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function NoPayslipCard() {
  return (
    <SectionCard title="Tu última nómina">
      <div className="flex flex-col items-center py-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-primary/10">
          <FileText className="size-5 text-primary-600 dark:text-primary" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">Aún no hay nóminas</p>
        <p className="mt-1 max-w-56 text-xs text-muted-foreground">Sube un PDF y verás aquí tu neto, IRPF y retenciones.</p>
        <a href="/app/upload" className={cn(buttonVariants({ size: "sm" }), "mt-4 gap-1.5")}>
          <Upload className="size-4" /> Subir nómina
        </a>
      </div>
    </SectionCard>
  );
}

const QUICK_ACTIONS = [
  { href: "/app/upload", label: "Subir nómina", icon: Upload },
  { href: "/app/transactions?nueva=1", label: "Nueva transacción", icon: Plus },
  { href: "/app/import", label: "Importar YNAB", icon: Download },
  { href: "/app/analytics", label: "Analítica", icon: TrendingUp },
];

// ─── Vista principal ────────────────────────────────────────────
function HomeDashboardView() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, retry: false });
  const { data: payroll, isLoading: loadingPayroll, error: payrollError, refetch: refetchPayroll } = useQuery({ queryKey: ["dashboard"], queryFn: () => getDashboard() });
  const { data: finance, isLoading: loadingFinance, error: financeError, refetch: refetchFinance } = useQuery({ queryKey: ["finance-summary"], queryFn: getFinanceSummary });
  const { data: trends = [] } = useQuery({ queryKey: ["finance-trends"], queryFn: () => getFinanceTrends() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const today = useMemo(getTodayIsoDate, []);
  const { data: txData } = useQuery({
    // Hasta hoy: las ocurrencias futuras de las recurrentes ya están generadas
    // y, ordenadas por fecha, ocupaban todos los puestos — la lista salía vacía
    // habiendo movimientos (o enseñaba como "recientes" gastos de la semana que viene).
    queryKey: ["transactions", { limit: 10, page: 1, to: today }],
    queryFn: () => getTransactions({ limit: 10, page: 1, to: today }),
  });
  const { data: latestPayslips } = useQuery({
    queryKey: ["payslips", { latest: true }],
    queryFn: () => getPayslips({ status: "parsed", type: "ordinal", sortBy: "period", sortDir: "desc", limit: 1 }),
  });

  const firstName = me?.name?.split(" ")[0];
  const latest = latestPayslips?.data[0];

  const derived = useMemo(() => {
    // El mes anterior por fecha, no "el penúltimo con actividad": si este mes
    // aún no tenía movimientos, se comparaba con el de hace dos meses.
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = trends.find((t) => t.month === prevKey);

    let netSeries: number[] = [];
    let previousNet: number | undefined;
    if (payroll && latest) {
      const profileName = payroll.profiles.find((p) => p.id === latest.profileId)?.name;
      const series = (profileName && payroll.evolution[profileName]) || [];
      netSeries = series.map((e) => e.net ?? 0).filter((v) => v > 0).slice(-12);
      const idx = series.findIndex((e) => e.month === `${latest.periodYear}-${String(latest.periodMonth).padStart(2, "0")}`);
      previousNet = idx > 0 ? series[idx - 1].net ?? undefined : undefined;
    }

    const irpfRates = payroll?.irpfEvolution.map((e) => e.rate).filter((r) => r > 0) ?? [];
    const irpfRate = irpfRates.length ? irpfRates.slice(-12).reduce((s, r) => s + r, 0) / Math.min(irpfRates.length, 12) : 0;

    const cashflow = trends.slice(-12).map((t) => ({ ...t, label: formatMonthLabel(t.month) }));
    const balanceSeries = (() => {
      let acc = (finance?.totalBalance ?? 0) - trends.reduce((s, t) => s + t.savings, 0);
      return trends.map((t) => (acc += t.savings));
    })();

    return { prevMonth, netSeries, previousNet, irpfRate, cashflow, balanceSeries };
  }, [trends, payroll, latest, finance]);

  if (loadingPayroll || loadingFinance) return <HomeSkeleton />;

  // Antes, si ambas fallaban (p. ej. un corte de red), un usuario con datos
  // reales veía la bienvenida de "primera vez" en vez de un aviso de error.
  if (payrollError && financeError) {
    return (
      <>
        <PageHeader eyebrow={todayLabel()} title={`${greeting()}${firstName ? "," : "."}`} accent={firstName ? `${firstName}.` : undefined} />
        <EmptyState icon={AlertTriangle} title="No se pudo cargar tu resumen" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => { refetchPayroll(); refetchFinance(); }}>Reintentar</Button>
        </EmptyState>
      </>
    );
  }

  const kpis = payroll?.kpis;
  const hasPayroll = !!kpis && kpis.totalPayslips > 0;
  const hasFinance = !!finance && (finance.totalBalance !== 0 || finance.monthExpenses !== 0 || accounts.length > 0);
  if (!hasPayroll && !hasFinance) return <Onboarding firstName={firstName} />;

  const recentTx = (txData?.data ?? []).filter((t) => !t.scheduledFor).slice(0, 8);
  const monthName = MONTHS_FULL[new Date().getMonth()];
  const prevMonthName = MONTHS_FULL[(new Date().getMonth() + 11) % 12];

  return (
    <div>
      <PageHeader
        eyebrow={todayLabel()}
        title={`${greeting()}${firstName ? "," : "."}`}
        accent={firstName ? `${firstName}.` : undefined}
        description={
          hasFinance && hasPayroll
            ? `Así van tus nóminas y tus finanzas en ${monthName}.`
            : hasPayroll
              ? "Así van tus nóminas."
              : `Así van tus finanzas en ${monthName}.`
        }
      />

      <StatGrid>
        {hasFinance && finance && (
          <>
            <StatCard
              label="Balance total"
              value={formatCurrency(finance.totalBalance)}
              icon={Wallet}
              hint={`${accounts.length} ${accounts.length === 1 ? "cuenta" : "cuentas"}`}
              sparkline={derived.balanceSeries.length > 2 ? derived.balanceSeries : undefined}
              emphasis
            />
            <StatCard
              label={`Ingresos de ${monthName}`}
              value={formatCurrency(finance.monthIncome)}
              icon={ArrowUpRight}
              // El mes en curso está a medias: un % frente a un mes entero engaña.
              // Se da la cifra del mes anterior como referencia.
              hint={derived.prevMonth ? `${capitalize(prevMonthName)}: ${formatCurrency(derived.prevMonth.income)}` : undefined}
            />
            <StatCard
              label={`Gastos de ${monthName}`}
              value={formatCurrency(finance.monthExpenses)}
              icon={ArrowDownRight}
              hint={derived.prevMonth ? `${capitalize(prevMonthName)}: ${formatCurrency(derived.prevMonth.expenses)}` : undefined}
            />
          </>
        )}
        {hasPayroll && kpis && latest && (
          <StatCard
            label="Último neto"
            value={formatCurrency(latest.netSalary)}
            icon={CircleDollarSign}
            delta={pctDelta(latest.netSalary ?? 0, derived.previousNet, "vs. anterior")}
            sparkline={derived.netSeries}
            sparklineColor={chartColors.primary}
          />
        )}
        {!hasFinance && hasPayroll && kpis && (
          <>
            <StatCard label="Neto medio" value={formatCurrency(kpis.avgNet)} icon={PiggyBank} hint={`${kpis.totalPayslips} nóminas`} />
            <StatCard
              label="Te llega del bruto"
              value={kpis.avgGross > 0 ? formatPct((kpis.avgNet / kpis.avgGross) * 100) : "—"}
              icon={TrendingUp}
              hint={`Bruto medio ${formatCurrency(kpis.avgGross)}`}
            />
            <StatCard label="IRPF efectivo" value={formatPct(derived.irpfRate)} icon={Receipt} hint={`${formatCurrency(kpis.avgIrpf)} de media al mes`} />
          </>
        )}
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {hasFinance ? (
          <ChartCard
            className="lg:col-span-2"
            title="Flujo de caja"
            description="Ingresos y gastos de los últimos 12 meses"
            action={<CardLink href="/app/finance/analytics">Analítica</CardLink>}
            height={260}
            legend={
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <LegendDot color={chartColors.primary} label="Ingresos" />
                <LegendDot color={chartColors.secondary} label="Gastos" />
                <LegendDot color={chartColors.tax} label="Ahorro" line />
              </div>
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={derived.cashflow} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />
                <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={chartBarCursor} />
                <Bar dataKey="income" name="Ingresos" fill={chartColors.primary} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expenses" name="Gastos" fill={chartColors.secondary} fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Line dataKey="savings" name="Ahorro" type="monotone" stroke={chartColors.tax} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        ) : (
          <ChartCard className="lg:col-span-2" title="Evolución del neto" description="Tu salario neto mes a mes" action={<CardLink href="/app/payroll">Dashboard</CardLink>} height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={derived.netSeries.map((v, i) => ({ i, net: v }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="net" name="Neto" fill={chartColors.primary} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {latest ? <LatestPayslipCard payslipId={latest.id} previousNet={derived.previousNet} /> : <NoPayslipCard />}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Actividad reciente"
          description={hasFinance ? "Tus últimos movimientos" : undefined}
          action={hasFinance ? <CardLink href="/app/transactions">Ver todo</CardLink> : undefined}
          flush
        >
          {recentTx.length > 0 ? (
            <ul className="divide-y divide-border">
              {recentTx.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}
            </ul>
          ) : (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <Receipt className="size-6 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">Sin movimientos todavía</p>
              <p className="mt-1 text-xs text-muted-foreground">Importa tu CSV de YNAB o añade una transacción.</p>
              <a href="/app/import" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4 gap-1.5")}>
                <Download className="size-4" /> Importar datos
              </a>
            </div>
          )}
        </SectionCard>

        <div className="flex flex-col gap-6">
          <SectionCard title="Cuentas" action={<CardLink href="/app/accounts">Gestionar</CardLink>} flush>
            {accounts.length > 0 ? (
              <ul className="divide-y divide-border">
                {accounts.filter((a) => !a.archived).slice(0, 5).map((a) => {
                  const Icon = ACCOUNT_ICONS[a.type] ?? Wallet;
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: a.color }}>
                        <Icon className="size-4" />
                      </div>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{a.name}</p>
                      <p className={cn("text-sm font-medium tabular-nums", a.balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                        {formatCurrency(a.balance)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-muted-foreground">Sin cuentas todavía</p>
                <a href="/app/accounts" className="mt-1 inline-block text-xs font-medium text-primary-700 dark:text-primary">Crear cuenta</a>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Accesos rápidos">
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((a) => (
                <a
                  key={a.href}
                  href={a.href}
                  className="group flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <a.icon className="size-4 text-muted-foreground transition-colors group-hover:text-primary-600 dark:group-hover:text-primary" />
                  {a.label}
                </a>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-full")} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default function HomeDashboardPage() {
  return (
    <Providers>
      <HomeDashboardView />
    </Providers>
  );
}
