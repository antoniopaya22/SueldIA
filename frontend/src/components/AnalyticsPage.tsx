import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, Bell, CalendarRange, CheckCircle2, CircleDollarSign, Download, FileText,
  Gift, Loader2, Sparkles, TrendingUp, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { exportData, getAnalytics, getProfiles, type AnalyticsData } from "../lib/api";
import { useSelectedProfile } from "../hooks/use-selected-profile";
import { formatCompact, formatCurrency, formatMonthLabel, formatPct, plural } from "../lib/format";
import { Providers } from "./Providers";
import {
  ChartCard, PageHeader, PageHeaderSkeleton, SectionCard, Segmented, StatCard, StatCardSkeleton, StatGrid,
  ChartCardSkeleton, chartActiveDot, chartAxis, chartBarCursor, chartColors, chartCursor, chartGrid,
  type StatDelta,
} from "./app";
import { ChartTooltip } from "./ui/ChartTooltip";
import { EmptyState } from "./ui/EmptyState";
import { ProfileSelector } from "./ui/ProfileSelector";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import { useUrlEnumParam, useUrlParam } from "../lib/url-state";
import { TaxSummaryCard } from "./payroll/TaxSummaryCard";

type Range = "12" | "24" | "all";
const RANGES: readonly Range[] = ["12", "24", "all"];
type Severity = "info" | "warning" | "critical";

const SEVERITY_META: Record<Severity, { icon: typeof Bell; label: string; className: string; dot: string }> = {
  info: { icon: Bell, label: "Aviso", className: "text-muted-foreground bg-muted", dot: "bg-slate-400" },
  warning: { icon: AlertTriangle, label: "Atención", className: "text-amber-700 bg-amber-500/10 dark:text-amber-400", dot: "bg-amber-500" },
  critical: { icon: AlertTriangle, label: "Importante", className: "text-red-700 bg-red-500/10 dark:text-red-400", dot: "bg-red-500" },
};

// Los valores de estas anomalías son porcentajes, no importes.
const PERCENT_ANOMALIES = new Set(["irpf_change", "low_retention"]);

function toMonthIndex(month: string): number | null {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  return y * 12 + (m - 1);
}

function fromMonthIndex(i: number): string {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

function buildEvolution(trends: AnalyticsData["trends"]) {
  const gross = new Map(trends.gross.map((p) => [p.month, p.value]));
  const net = new Map(trends.net.map((p) => [p.month, p.value]));
  const idx = [...new Set([...gross.keys(), ...net.keys()].map(toMonthIndex).filter((v): v is number => v !== null))].sort((a, b) => a - b);
  if (!idx.length) return [];
  const out: { month: string; label: string; bruto: number | null; neto: number | null }[] = [];
  for (let i = idx[0]; i <= idx[idx.length - 1]; i++) {
    const key = fromMonthIndex(i);
    out.push({ month: key, label: formatMonthLabel(key), bruto: gross.get(key) ?? null, neto: net.get(key) ?? null });
  }
  return out;
}

function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="15" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

function AnalyticsSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>{Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}</StatGrid>
      <ChartCardSkeleton className="mt-6" height={300} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}

function AnalyticsView() {
  const { data: profiles = [], isLoading: profilesLoading } = useQuery({ queryKey: ["profiles"], queryFn: getProfiles });
  const [selectedProfile, setSelectedProfile] = useSelectedProfile(profiles.map((p) => p.id));
  // En la URL: compartible y no se pierde al volver desde otra página.
  const [range, setRange] = useUrlEnumParam<Range>("rango", RANGES, "24");
  const [yoyMetric, setYoyMetric] = useUrlEnumParam("metrica", ["net", "gross"] as const, "net");
  const [concept, setConceptParam] = useUrlParam("concepto");
  const setConcept = (c: string) => setConceptParam(c);
  const [exportYear, setExportYear] = useState<string>("all");
  const [exporting, setExporting] = useState(false);

  const { data: analytics, isLoading, error, refetch } = useQuery({
    queryKey: ["analytics", selectedProfile],
    queryFn: () => getAnalytics(selectedProfile!),
    enabled: !!selectedProfile,
  });

  const profile = profiles.find((p) => p.id === selectedProfile);

  const derived = useMemo(() => {
    if (!analytics) return null;
    const evolution = buildEvolution(analytics.trends);
    const years = [...new Set(evolution.map((e) => Number(e.month.slice(0, 4))))].sort((a, b) => b - a);
    const netValues = analytics.trends.net.map((p) => p.value);
    const lastNet = netValues.at(-1);
    const prevNet = netValues.at(-2);
    let netDelta: StatDelta | undefined;
    if (lastNet != null && prevNet) {
      const change = ((lastNet - prevNet) / prevNet) * 100;
      const trend = Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down";
      netDelta = { value: `${change > 0 ? "+" : ""}${formatPct(change)}`, trend, label: "vs. mes anterior" };
    }
    const yoy = yoyMetric === "net" ? analytics.trends.yoyNet : analytics.trends.yoyGross;
    const yoyAvg = analytics.trends.yoyNet.length
      ? analytics.trends.yoyNet.reduce((s, d) => s + d.change, 0) / analytics.trends.yoyNet.length
      : null;

    // Proyección: últimos 6 meses reales + predicción, con un punto puente
    // para que la línea discontinua salga del último dato real.
    const recent = evolution.filter((e) => e.neto != null).slice(-6);
    const projection = [
      ...recent.map((e, i) => ({
        label: e.label,
        neto: e.neto,
        bruto: e.bruto,
        netoEst: i === recent.length - 1 ? e.neto : null,
        brutoEst: i === recent.length - 1 ? e.bruto : null,
      })),
      ...analytics.predictions.map((p) => ({
        label: formatMonthLabel(p.month),
        neto: null,
        bruto: null,
        netoEst: p.predictedNet,
        brutoEst: p.predictedGross,
      })),
    ];

    const concepts = Object.entries(analytics.trends.conceptTrends)
      .filter(([, series]) => series.length > 1)
      .sort((a, b) => b[1].reduce((s, p) => s + p.value, 0) - a[1].reduce((s, p) => s + p.value, 0))
      .map(([name]) => name);

    return { evolution, years, lastNet, netDelta, yoy, yoyAvg, projection, concepts, netValues };
  }, [analytics, yoyMetric]);

  const activeConcept = derived?.concepts.includes(concept) ? concept : derived?.concepts[0] ?? "";
  const conceptSeries = useMemo(
    () => (analytics && activeConcept ? (analytics.trends.conceptTrends[activeConcept] ?? []).map((p) => ({ label: formatMonthLabel(p.month), value: p.value })) : []),
    [analytics, activeConcept],
  );

  const handleExport = async (format: "xlsx" | "csv" | "json") => {
    if (!selectedProfile) return;
    setExporting(true);
    try {
      await exportData(selectedProfile, exportYear === "all" ? undefined : Number(exportYear), format);
    } catch {
      toast.error("No se pudo exportar. Inténtalo de nuevo.");
    } finally {
      setExporting(false);
    }
  };

  if (profilesLoading || (selectedProfile && isLoading)) return <AnalyticsSkeleton />;

  if (profiles.length === 0) {
    return (
      <>
        <PageHeader title="Analítica" accent="de tus nóminas." />
        <EmptyState
          icon={Activity}
          title="Aún no hay datos que analizar"
          description="Crea un perfil y sube tus nóminas para ver tendencias, comparativas y proyecciones."
          actionLabel="Crear perfil"
          actionHref="/app/profiles"
        />
      </>
    );
  }

  const profileSwitcher = profiles.length > 1 && (
    <ProfileSelector profiles={profiles} value={selectedProfile ?? profiles[0].id} onChange={(v) => setSelectedProfile(v as number)} />
  );

  if (error || !analytics || !derived) {
    return (
      <>
        <PageHeader title="Analítica" accent="de tus nóminas.">{profileSwitcher}</PageHeader>
        <EmptyState icon={AlertTriangle} title="No se pudo cargar la analítica" description="Vuelve a intentarlo en unos segundos.">
          <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </EmptyState>
      </>
    );
  }

  if (derived.evolution.length === 0) {
    return (
      <>
        <PageHeader title="Analítica" accent="de tus nóminas." description={`Todavía no hay nóminas procesadas de ${profile?.name ?? "este perfil"}.`}>
          {profileSwitcher}
        </PageHeader>
        <EmptyState
          icon={FileText}
          title="Sube tus nóminas para empezar"
          description="Con dos o más nóminas verás aquí la evolución de tu salario, la comparativa con el año anterior y una proyección de los próximos meses."
          actionLabel="Subir nóminas"
          actionHref={`/app/upload?perfil=${selectedProfile}`}
          actionIcon={Upload}
        />
      </>
    );
  }

  const { evolution, years, lastNet, netDelta, yoy, yoyAvg, projection, concepts, netValues } = derived;
  const visibleEvolution = range === "all" ? evolution : evolution.slice(-Number(range));
  const firstPrediction = analytics.predictions[0];
  const issues = [
    ...analytics.anomalies.map((a) => ({ ...a, kind: "anomaly" as const })),
    ...analytics.alerts.map((a) => ({ ...a, kind: "alert" as const, month: undefined as string | undefined, value: undefined as number | undefined, expected: undefined as number | undefined })),
  ].sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a.severity] - ({ critical: 0, warning: 1, info: 2 })[b.severity]);
  const lastLabel = evolution.at(-1)?.label;
  const evolutionDomain: [(min: number) => number, "auto"] = [(min) => Math.max(0, Math.floor((min * 0.85) / 100) * 100), "auto"];
  // Conceptos casi constantes: sin esto el eje empieza en 0 y la línea sale plana.
  const conceptDomain: [(min: number) => number, (max: number) => number] = [
    (min) => Math.max(0, Math.floor(min * 0.9)),
    (max) => Math.ceil(max * 1.05),
  ];

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CalendarRange className="size-3.5" />
            {evolution[0].label} – {lastLabel}
          </span>
        }
        title="Analítica"
        accent="de tus nóminas."
        description={`Tendencias, comparativas y proyecciones de ${profile?.name ?? "este perfil"}.`}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5" disabled={exporting} />}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Periodo</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={exportYear} onValueChange={(v) => setExportYear(String(v))}>
                  <DropdownMenuRadioItem value="all" closeOnClick={false}>Todo el histórico</DropdownMenuRadioItem>
                  {years.map((y) => (
                    <DropdownMenuRadioItem key={y} value={String(y)} closeOnClick={false}>{y}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => handleExport("xlsx")}>Descargar Excel</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("csv")}>Descargar CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("json")}>Descargar JSON</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {profileSwitcher}
      </PageHeader>

      <StatGrid>
        <StatCard
          label="Último neto"
          value={formatCurrency(lastNet)}
          icon={CircleDollarSign}
          delta={netDelta}
          sparkline={netValues.slice(-12)}
          emphasis
        />
        <StatCard
          label="Vs. año anterior"
          value={yoyAvg == null ? "—" : `${yoyAvg > 0 ? "+" : ""}${formatPct(yoyAvg)}`}
          icon={TrendingUp}
          hint={yoyAvg == null ? "Hace falta un año de histórico" : `Neto medio, ${plural(analytics.trends.yoyNet.length, "mes comparado", "meses comparados")}`}
        />
        <StatCard
          label="Proyección"
          value={firstPrediction ? formatCurrency(firstPrediction.predictedNet) : "—"}
          icon={Sparkles}
          hint={firstPrediction ? `Neto estimado para ${formatMonthLabel(firstPrediction.month)}` : "Sin datos suficientes"}
        />
        <StatCard
          className="hidden sm:flex"
          label="Avisos"
          value={issues.length}
          icon={Bell}
          hint={issues.length ? `${analytics.anomalies.length} ${analytics.anomalies.length === 1 ? "anomalía" : "anomalías"} · ${analytics.alerts.length} ${analytics.alerts.length === 1 ? "recordatorio" : "recordatorios"}` : "Todo en orden"}
        />
      </StatGrid>

      <ChartCard
        className="mt-6"
        title="Evolución salarial"
        description="Bruto (discontinuo) y neto de las nóminas mensuales"
        height={300}
        exportTable={() => ({ headers: ["Mes", "Bruto", "Neto"], rows: visibleEvolution.map((e) => [e.label, e.bruto ?? null, e.neto ?? null]) })}
        action={
          <Segmented<Range>
            aria-label="Rango"
            value={range}
            onChange={setRange}
            options={[
              { value: "12", label: "12 m" },
              { value: "24", label: "24 m" },
              { value: "all", label: "Todo" },
            ]}
          />
        }
        legend={
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <LegendKey color={chartColors.secondary} dashed label="Bruto" />
            <LegendKey color={chartColors.primary} label="Neto" />
          </div>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart accessibilityLayer data={visibleEvolution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="an-neto" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.22} />
                <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={evolutionDomain} />
            <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
            <Area type="monotone" dataKey="bruto" name="Bruto" stroke={chartColors.secondary} strokeWidth={1.75} strokeDasharray="5 4" fill="none" dot={false} activeDot={chartActiveDot} connectNulls />
            <Area type="monotone" dataKey="neto" name="Neto" stroke={chartColors.primary} strokeWidth={2} fill="url(#an-neto)" dot={false} activeDot={chartActiveDot} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Este año frente al anterior"
          description={yoy.length ? "Mismo mes, año actual y año anterior" : "Aparecerá cuando tengas un año de histórico"}
          height={260}
          exportTable={() => ({ headers: ["Mes", "Año actual", "Año anterior"], rows: yoy.map((d) => [formatMonthLabel(d.month), d.current, d.previous]) })}
          action={
            <Segmented
              aria-label="Métrica"
              value={yoyMetric}
              onChange={setYoyMetric}
              options={[
                { value: "net", label: "Neto" },
                { value: "gross", label: "Bruto" },
              ]}
            />
          }
          legend={
            yoy.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: chartColors.primary }} />Año actual</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full opacity-50" style={{ backgroundColor: chartColors.secondary }} />Año anterior</span>
              </div>
            )
          }
        >
          {yoy.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer data={yoy.map((d) => ({ label: formatMonthLabel(d.month).split(" ")[0], actual: d.current, anterior: d.previous }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...chartAxis} />
                <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={chartBarCursor} />
                <Bar dataKey="anterior" name="Año anterior" fill={chartColors.secondary} fillOpacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="actual" name="Año actual" fill={chartColors.primary} radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Sin meses comparables todavía
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Proyección"
          exportTable={() => ({ headers: ["Mes", "Neto", "Neto estimado"], rows: projection.map((p) => [p.label, p.neto ?? null, p.neto == null ? p.netoEst ?? null : null]) })}
          description={analytics.predictions.length ? `${analytics.predictions.length === 1 ? "Próximo mes" : `Próximos ${analytics.predictions.length} meses`} por regresión lineal` : "Hace falta más histórico para estimar"}
          height={260}
          legend={
            analytics.predictions.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                <LegendKey color={chartColors.primary} label="Neto real" />
                <LegendKey color={chartColors.primary} dashed label="Neto estimado" />
                <span className="ml-auto flex gap-2">
                  {analytics.predictions.map((p) => (
                    <span key={p.month} className="rounded-md border border-border px-2 py-1 tabular-nums">
                      <span className="text-muted-foreground">{formatMonthLabel(p.month)}</span>{" "}
                      <span className="font-medium text-foreground">{formatCompact(p.predictedNet)}</span>
                    </span>
                  ))}
                </span>
              </div>
            )
          }
        >
          {analytics.predictions.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart accessibilityLayer data={projection} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...chartAxis} />
                <YAxis {...chartAxis} tickFormatter={formatCompact} width={52} domain={evolutionDomain} />
                <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
                {lastLabel && <ReferenceLine x={lastLabel} stroke="var(--border)" strokeDasharray="3 3" />}
                <Line type="monotone" dataKey="neto" name="Neto" stroke={chartColors.primary} strokeWidth={2} dot={{ r: 2.5, fill: chartColors.primary }} activeDot={chartActiveDot} connectNulls={false} />
                <Line type="monotone" dataKey="netoEst" name="Neto estimado" stroke={chartColors.primary} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, fill: "var(--card)", stroke: chartColors.primary }} activeDot={chartActiveDot} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Sube al menos 3 nóminas para ver una proyección
            </div>
          )}
        </ChartCard>
      </div>

      {concepts.length > 0 && (
        <ChartCard
          className="mt-6"
          title="Evolución por concepto"
          description="Cómo ha cambiado cada línea de tu nómina"
          height={240}
          exportTable={() => ({ headers: ["Mes", activeConcept], rows: conceptSeries.map((p) => [p.label, p.value]) })}
          action={
            <Select value={activeConcept} onValueChange={(v) => v && setConcept(v)}>
              <SelectTrigger size="sm" className="w-36 sm:w-52" aria-label="Concepto">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {concepts.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart accessibilityLayer data={conceptSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="an-concept" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.secondary} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={chartColors.secondary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={conceptDomain} tickCount={4} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
              <Area type="stepAfter" dataKey="value" name={activeConcept} stroke={chartColors.secondary} strokeWidth={2} fill="url(#an-concept)" dot={false} activeDot={chartActiveDot} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <SectionCard
          className="lg:col-span-3"
          title="Avisos y anomalías"
          description="Cambios que conviene revisar en tus nóminas"
          flush
        >
          {issues.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="size-5 text-primary-600 dark:text-primary" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">Todo en orden</p>
              <p className="mt-1 text-xs text-muted-foreground">No hemos detectado nada fuera de lo normal.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {issues.map((a, i) => {
                const meta = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
                const Icon = meta.icon;
                const isPct = PERCENT_ANOMALIES.has(a.type);
                return (
                  <li key={i} className="flex gap-3 px-5 py-4">
                    <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.className)}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{a.message}</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {a.month && <span>{formatMonthLabel(a.month)}</span>}
                        {a.value != null && a.expected != null && (
                          <span className="tabular-nums">
                            {isPct ? formatPct(a.value) : formatCurrency(a.value)}
                            <span className="text-muted-foreground"> · esperado {isPct ? formatPct(a.expected) : formatCurrency(a.expected)}</span>
                          </span>
                        )}
                        {a.kind === "alert" && <span>Recordatorio</span>}
                      </p>
                    </div>
                    <span className={cn("hidden h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium sm:inline-flex", meta.className)}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard className="lg:col-span-2" title="Pagas extra" icon={Gift} flush>
          {analytics.extras.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No hay pagas extra registradas. Márcalas al subirlas o desde el detalle de la nómina.</p>
          ) : (
            <ul className="divide-y divide-border">
              {analytics.extras.map((e) => (
                <li key={e.year} className="flex items-center gap-4 px-5 py-3.5">
                  <div>
                    <p className="text-sm font-semibold tabular-nums text-foreground">{e.year}</p>
                    <p className="text-xs text-muted-foreground">{e.count} {e.count === 1 ? "paga" : "pagas"}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(e.totalNet)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">de {formatCurrency(e.totalGross)} brutos</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {selectedProfile && years.length > 0 && (
        <div className="mt-6">
          <TaxSummaryCard profileId={selectedProfile} years={years} />
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Providers>
      <AnalyticsView />
    </Providers>
  );
}
