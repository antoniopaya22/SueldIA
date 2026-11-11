import { useState, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, ComposedChart,
} from "recharts";
import {
  CalendarRange, FileText, BarChart3, ArrowUp, ArrowDown, ArrowUpDown,
  AreaChart as AreaIcon, LineChart as LineIcon, CircleDollarSign, Landmark, Receipt, Percent, Gift, X,
  AlertTriangle,
} from "lucide-react";
import { getDashboard, getProfiles, type DashboardData } from "../lib/api";
import { Providers } from "./Providers";
import { formatCurrency, formatCompact, formatMonthLabel, formatPct, plural } from "../lib/format";
import { ChartTooltip } from "./ui/ChartTooltip";
import { ProfileSelector } from "./ui/ProfileSelector";
import { EmptyState } from "./ui/EmptyState";
import { adaptiveColor } from "../lib/color";
import {
  PageHeader, StatCard, StatGrid, SectionCard, ChartCard, Segmented,
  PageHeaderSkeleton, StatCardSkeleton, ChartCardSkeleton,
  chartAxis, chartGrid, chartColors, chartPalette, chartCursor, chartBarCursor, chartActiveDot, chartTooltipStyle,
  type StatDelta,
} from "./app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "cn";
import { isIrpfConcept } from "../lib/payslip-concepts";
import { setUrlParams, useUrlParam } from "../lib/url-state";

type ConceptBreakdownItem = DashboardData["conceptBreakdown"][number];
type ConceptSortColumn = "name" | "category" | "average" | "total" | "count";
type SortDirection = "asc" | "desc";

const CONCEPT_CATEGORY_LABELS: Record<string, string> = {
  devengo: "Devengo",
  deduccion: "Deducción",
};

function getConceptCategoryLabel(category: string): string {
  return CONCEPT_CATEGORY_LABELS[category] ?? "Otros";
}

function getConceptSortDirection(column: ConceptSortColumn): SortDirection {
  return column === "name" || column === "category" ? "asc" : "desc";
}

function compareConceptRows(left: ConceptBreakdownItem, right: ConceptBreakdownItem, column: ConceptSortColumn): number {
  switch (column) {
    case "name":
      return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
    case "category":
      return getConceptCategoryLabel(left.category).localeCompare(getConceptCategoryLabel(right.category), "es", { sensitivity: "base" });
    case "average":
      return left.average - right.average;
    case "total":
      return left.total - right.total;
    case "count":
      return left.count - right.count;
    default:
      return 0;
  }
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown className="size-3.5 opacity-50" />;
  return direction === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />;
}

function toMonthIndex(month: string): number | null {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthNumber = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  return year * 12 + (monthNumber - 1);
}

function fromMonthIndex(monthIndex: number): string {
  const year = Math.floor(monthIndex / 12);
  const monthNumber = (monthIndex % 12) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function buildContinuousMonths(months: string[]): string[] {
  const monthIndices = months
    .map(toMonthIndex)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (monthIndices.length === 0) return [];
  const uniqueMonthIndices = Array.from(new Set(monthIndices));
  const firstMonth = uniqueMonthIndices[0];
  const lastMonth = uniqueMonthIndices[uniqueMonthIndices.length - 1];
  const continuousMonths: string[] = [];
  for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex += 1) {
    continuousMonths.push(fromMonthIndex(monthIndex));
  }
  return continuousMonths;
}

function buildAvailableMonths(evolution: DashboardData["evolution"] | undefined): string[] {
  if (!evolution) return [];
  const months = new Set<string>();
  Object.values(evolution).forEach((entries) => entries.forEach((entry) => months.add(entry.month)));
  return Array.from(months).sort((left, right) => (toMonthIndex(left) ?? 0) - (toMonthIndex(right) ?? 0));
}


// irpfEvolution/monthlySavings traen una fila por nómina: con varios perfiles
// hay que agregarlas por mes o las series alternan entre personas.
function aggregateByMonth(data: DashboardData) {
  const irpf = new Map<string, { amount: number; gross: number }>();
  const savings = new Map<string, { gross: number; net: number }>();
  data.monthlySavings.forEach((m, i) => {
    const s = savings.get(m.month) ?? { gross: 0, net: 0 };
    s.gross += m.gross;
    s.net += m.net;
    savings.set(m.month, s);
    const irpfRow = data.irpfEvolution[i];
    if (irpfRow && irpfRow.month === m.month) {
      const e = irpf.get(m.month) ?? { amount: 0, gross: 0 };
      e.amount += irpfRow.amount;
      e.gross += m.gross;
      irpf.set(m.month, e);
    }
  });
  const byMonth = (a: string, b: string) => (toMonthIndex(a) ?? 0) - (toMonthIndex(b) ?? 0);
  const irpfSeries = [...irpf.entries()].sort(([a], [b]) => byMonth(a, b)).map(([month, e]) => ({
    month,
    monthLabel: formatMonthLabel(month),
    amount: Math.round(e.amount * 100) / 100,
    rate: e.gross ? Math.round((e.amount / e.gross) * 10000) / 100 : 0,
  }));
  const retentionSeries = [...savings.entries()].sort(([a], [b]) => byMonth(a, b)).map(([month, s]) => ({
    month,
    monthLabel: formatMonthLabel(month),
    retentionRate: s.gross ? Math.round((s.net / s.gross) * 10000) / 100 : 0,
  }));
  return { irpfSeries, retentionSeries };
}

function lastDelta(series: number[], label: string, invert = false): StatDelta | undefined {
  const values = series.filter((v) => v > 0);
  if (values.length < 2) return undefined;
  const [prev, curr] = values.slice(-2);
  const change = ((curr - prev) / prev) * 100;
  const trend = Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down";
  const tone = trend === "flat" ? "neutral" : (trend === "up") !== invert ? "positive" : "negative";
  return { value: `${change > 0 ? "+" : ""}${formatPct(change)}`, trend, tone, label };
}

// ─── Skeleton ───────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </StatGrid>
      <ChartCardSkeleton className="mt-6" height={320} />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ChartCardSkeleton className="lg:col-span-2" />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}

// ─── Vista ──────────────────────────────────────────────────────
function DashboardView() {
  const { data: profiles = [], isLoading: profilesLoading, error: profilesError, refetch: refetchProfiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: getProfiles,
  });

  // Selección en la URL (?perfiles=1,2&desde=2025-01&hasta=2025-12&anio=2025):
  // se comparte, sobrevive a una recarga y a volver desde otra página. Antes el
  // rango arrancaba en una fecha fija ("2021-11") que no tenía que ver con el usuario.
  const [profilesParam, setProfilesParam] = useUrlParam("perfiles");
  const selectedProfiles = useMemo(
    () => profilesParam.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    [profilesParam],
  );
  const setSelectedProfiles = (ids: number[]) => setProfilesParam(ids.join(",") || null);
  const [chartType, setChartType] = useState<"area" | "line">("area");
  const [yearParam, setYearParam] = useUrlParam("anio");
  const selectedYear = /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;
  const setSelectedYear = (y: number | null) => setYearParam(y);
  const [rangeFrom] = useUrlParam("desde");
  const [rangeTo] = useUrlParam("hasta");
  const [conceptSort, setConceptSort] = useState<{ column: ConceptSortColumn; direction: SortDirection }>({
    column: "total",
    direction: "desc",
  });

  const profileIds = selectedProfiles.length > 0 ? selectedProfiles : profiles.map((p) => p.id);

  const { data: fullDashboardData, isLoading: isDashboardLoading, error: dashboardError, refetch: refetchDashboard } = useQuery({
    queryKey: ["dashboard", profileIds],
    queryFn: () => getDashboard(profileIds),
    enabled: profiles.length > 0,
  });

  const availableMonths = useMemo(() => buildAvailableMonths(fullDashboardData?.evolution), [fullDashboardData]);

  const selectedRangeFrom = rangeFrom && availableMonths.includes(rangeFrom) ? rangeFrom : "";
  const selectedRangeTo = rangeTo && availableMonths.includes(rangeTo) ? rangeTo : "";
  const hasDateFilter = Boolean(selectedRangeFrom || selectedRangeTo);

  const {
    data: filteredDashboardData,
    isLoading: isFilteredDashboardLoading,
    isFetching: isFilteredDashboardFetching,
    error: filteredDashboardError,
    refetch: refetchFilteredDashboard,
  } = useQuery({
    queryKey: ["dashboard", profileIds, selectedRangeFrom || null, selectedRangeTo || null],
    queryFn: () => getDashboard(profileIds, selectedRangeFrom || undefined, selectedRangeTo || undefined),
    enabled: profiles.length > 0 && hasDateFilter,
  });

  const data = hasDateFilter ? filteredDashboardData ?? fullDashboardData : fullDashboardData;
  const isLoading = !data && (isDashboardLoading || isFilteredDashboardLoading);
  // Sin esto, un fallo de red dejaba `data` en undefined para siempre y la
  // página se quedaba en el esqueleto de carga sin fin, o peor: con
  // profiles.length en 0 por el fallo, parecía que no había nóminas.
  const loadError = profilesError || (hasDateFilter ? filteredDashboardError : dashboardError);
  const retryLoad = () => {
    refetchProfiles();
    if (hasDateFilter) refetchFilteredDashboard();
    else refetchDashboard();
  };

  // Si el nuevo extremo cruza el otro, el otro se ajusta a él.
  const handleRangeFromChange = (value: string) =>
    setUrlParams({ desde: value, hasta: !rangeTo || !value || rangeTo >= value ? rangeTo : value });

  const handleRangeToChange = (value: string) =>
    setUrlParams({ hasta: value, desde: !rangeFrom || !value || rangeFrom <= value ? rangeFrom : value });

  const clearDateRange = () => setUrlParams({ desde: null, hasta: null });

  const activeRangeLabel = availableMonths.length > 0
    ? `${formatMonthLabel(selectedRangeFrom || availableMonths[0])} – ${formatMonthLabel(selectedRangeTo || availableMonths[availableMonths.length - 1])}`
    : "Todo el histórico";

  // ─── Datos derivados ────────────────────────────────────────
  const derived = useMemo(() => {
    if (!data) return null;

    const allMonths = new Set<string>();
    Object.values(data.evolution).forEach((entries) => entries.forEach((e) => allMonths.add(e.month)));
    const sorted = buildContinuousMonths(Array.from(allMonths));

    const evolutionData = sorted.map((month) => {
      const point: Record<string, string | number | null> = { month, monthLabel: formatMonthLabel(month) };
      let gross = 0;
      let net = 0;
      Object.entries(data.evolution).forEach(([profileName, entries]) => {
        const entry = entries.find((e) => e.month === month);
        const g = entry?.gross ?? 0;
        const n = entry?.net ?? 0;
        point[`${profileName}_bruto`] = entry ? g : null;
        point[`${profileName}_neto`] = entry ? n : null;
        gross += g;
        net += n;
      });
      point.totalBruto = gross;
      point.totalNeto = net;
      point.totalDeducciones = gross - net;
      return point;
    });

    const profileNames = Object.keys(data.evolution);
    const profileColors: Record<string, string> = {};
    data.profiles.forEach((p) => { profileColors[p.name] = p.color; });

    const devengos = data.conceptBreakdown.filter((c) => c.category === "devengo").sort((a, b) => b.average - a.average).slice(0, 7);
    const deducciones = data.conceptBreakdown.filter((c) => c.category === "deduccion").sort((a, b) => b.average - a.average).slice(0, 7);

    const netSeries = evolutionData.map((p) => Number(p.totalNeto) || 0);
    const grossSeries = evolutionData.map((p) => Number(p.totalBruto) || 0);
    const { irpfSeries, retentionSeries } = aggregateByMonth(data);
    const irpfRates = irpfSeries.map((e) => e.rate);
    const totalIrpf = irpfSeries.reduce((s, e) => s + e.amount, 0);
    const totalGrossRegular = data.monthlySavings.reduce((s, m) => s + m.gross, 0);
    const avgIrpfRate = totalGrossRegular ? (totalIrpf / totalGrossRegular) * 100 : 0;
    const retentionRate = data.kpis.avgGross > 0 ? (data.kpis.avgNet / data.kpis.avgGross) * 100 : 0;
    const devengosTotal = devengos.reduce((s, c) => s + c.average, 0);

    return { evolutionData, profileNames, profileColors, devengos, deducciones, devengosTotal, netSeries, grossSeries, irpfRates, avgIrpfRate, retentionRate, irpfSeries, retentionSeries };
  }, [data]);

  const sortedConceptBreakdown = useMemo(() => {
    if (!data) return [] as DashboardData["conceptBreakdown"];
    const directionMultiplier = conceptSort.direction === "asc" ? 1 : -1;
    return [...data.conceptBreakdown].sort((left, right) => {
      const primaryResult = compareConceptRows(left, right, conceptSort.column) * directionMultiplier;
      if (primaryResult !== 0) return primaryResult;
      return left.name.localeCompare(right.name, "es", { sensitivity: "base" });
    });
  }, [conceptSort, data]);

  const handleConceptSort = (column: ConceptSortColumn) => {
    setConceptSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: getConceptSortDirection(column) },
    );
  };

  const emptyState = (
    <EmptyState
      icon={BarChart3}
      title="Sin nóminas todavía"
      description="Sube tus primeras nóminas en PDF para ver tu evolución salarial, retenciones y el desglose de cada concepto."
      actionLabel="Subir nóminas"
      actionHref="/app/upload"
      actionIcon={FileText}
    />
  );

  if (loadError && !isLoading) {
    return (
      <>
        <PageHeader title="Nóminas" description="Tu evolución salarial, en un vistazo." />
        <EmptyState
          icon={AlertTriangle}
          title="No se pudieron cargar tus nóminas"
          description="Vuelve a intentarlo en unos segundos."
        >
          <Button variant="outline" onClick={retryLoad}>Reintentar</Button>
        </EmptyState>
      </>
    );
  }
  if (profiles.length === 0 && !profilesLoading) return <><PageHeader title="Nóminas" description="Tu evolución salarial, en un vistazo." />{emptyState}</>;
  if (isLoading || !data || !derived) return <DashboardSkeleton />;

  const rangeControls = availableMonths.length > 1 && (
    <div className="flex flex-wrap items-center gap-2">
      <MonthRangeSelect label="Desde" value={selectedRangeFrom} placeholder="Inicio" options={availableMonths} onChange={handleRangeFromChange} />
      <span className="text-muted-foreground">–</span>
      <MonthRangeSelect label="Hasta" value={selectedRangeTo} placeholder="Hoy" options={availableMonths} onChange={handleRangeToChange} />
      {hasDateFilter && (
        <Button variant="ghost" size="sm" onClick={clearDateRange} className="gap-1 text-muted-foreground">
          <X className="size-3.5" /> Todo
        </Button>
      )}
    </div>
  );

  const header = (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="size-3.5" />
          {hasDateFilter && isFilteredDashboardFetching ? "Actualizando…" : activeRangeLabel}
        </span>
      }
      title="Tus nóminas,"
      accent="al detalle."
      description="Evolución, retenciones y desglose de conceptos de los perfiles seleccionados."
      actions={rangeControls}
    >
      {profiles.length > 1 && (
        <ProfileSelector profiles={profiles} value={profileIds} onChange={(v) => setSelectedProfiles(v as number[])} multi />
      )}
    </PageHeader>
  );

  if (data.kpis.totalPayslips === 0) {
    return (
      <>
        {header}
        {hasDateFilter ? (
          <EmptyState icon={CalendarRange} title="No hay nóminas en este rango" description="Prueba con otro periodo o vuelve a ver todo el histórico disponible.">
            <Button variant="outline" onClick={clearDateRange}>Ver todo el histórico</Button>
          </EmptyState>
        ) : emptyState}
      </>
    );
  }

  const { evolutionData, profileNames, profileColors, devengos, deducciones, devengosTotal, netSeries, grossSeries, irpfRates, avgIrpfRate, retentionRate, irpfSeries, retentionSeries } = derived;
  const multiProfile = profileNames.length > 1;
  const profileColor = (name: string, fallback: string) => (multiProfile ? adaptiveColor(profileColors[name], fallback) : fallback);
  const brutoColor = (name: string) => profileColor(name, chartColors.secondary);
  const netoColor = (name: string) => profileColor(name, chartColors.primary);
  const irpfData = irpfSeries;
  const retentionData = retentionSeries;
  const evolutionDomain: [(min: number) => number, "auto"] = [(min) => Math.max(0, Math.floor((min * 0.85) / 100) * 100), "auto"];
  const summaries = selectedYear ? data.annualSummaries.filter((s) => s.year === selectedYear) : data.annualSummaries;

  return (
    <div>
      {header}

      <StatGrid>
        <StatCard
          label="Neto medio"
          value={formatCurrency(data.kpis.avgNet)}
          icon={CircleDollarSign}
          delta={lastDelta(netSeries, "último mes")}
          sparkline={netSeries.filter((v) => v > 0).slice(-12)}
          emphasis
        />
        <StatCard
          label="Bruto medio"
          value={formatCurrency(data.kpis.avgGross)}
          icon={Landmark}
          delta={lastDelta(grossSeries, "último mes")}
          sparkline={grossSeries.filter((v) => v > 0).slice(-12)}
          sparklineColor={chartColors.secondary}
        />
        <StatCard
          label="IRPF efectivo"
          value={formatPct(avgIrpfRate)}
          icon={Receipt}
          hint={`${formatCurrency(data.kpis.avgIrpf)} por nómina`}
          delta={lastDelta(irpfRates, "último mes", true)}
          sparkline={irpfRates.slice(-12)}
          sparklineColor={chartColors.tax}
        />
        <StatCard
          label="Te llega del bruto"
          value={formatPct(retentionRate)}
          icon={Percent}
          hint={
            data.kpis.extrasCount > 0
              ? `${data.kpis.totalPayslips} nóminas · ${data.kpis.extrasCount} ${data.kpis.extrasCount === 1 ? "paga extra" : "pagas extra"}`
              : plural(data.kpis.totalPayslips, "nómina", "nóminas")
          }
        />
      </StatGrid>

      {/* Evolución */}
      <ChartCard
        className="mt-6"
        title="Evolución salarial"
        description={multiProfile ? "Bruto (discontinuo) y neto por perfil" : "Bruto y neto mes a mes"}
        height={320}
        exportTable={() => ({
          headers: ["Mes", ...profileNames.flatMap((n) => multiProfile ? [`${n} · bruto`, `${n} · neto`] : ["Bruto", "Neto"])],
          rows: evolutionData.map((p) => [String(p.monthLabel), ...profileNames.flatMap((n) => [p[`${n}_bruto`] as number | null, p[`${n}_neto`] as number | null])]),
        })}
        action={
          <Segmented
            aria-label="Tipo de gráfico"
            value={chartType}
            onChange={setChartType}
            iconOnly
            options={[
              { value: "area", label: "Área", icon: AreaIcon },
              { value: "line", label: "Línea", icon: LineIcon },
            ]}
          />
        }
        legend={
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            {profileNames.map((name) => (
              <span key={name} className="inline-flex items-center gap-3">
                <LegendKey color={brutoColor(name)} dashed label={multiProfile ? `${name} · bruto` : "Bruto"} />
                <LegendKey color={netoColor(name)} label={multiProfile ? `${name} · neto` : "Neto"} />
              </span>
            ))}
          </div>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "area" ? (
            <AreaChart accessibilityLayer data={evolutionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {profileNames.map((name, i) => (
                  <linearGradient key={name} id={`gradNeto${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={netoColor(name)} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={netoColor(name)} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="monthLabel" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={evolutionDomain} />
              <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
              {profileNames.map((name) => (
                <Area key={`${name}_bruto`} type="monotone" dataKey={`${name}_bruto`} name={multiProfile ? `${name} · bruto` : "Bruto"} stroke={brutoColor(name)} strokeWidth={1.75} strokeDasharray="5 4" fill="none" dot={false} activeDot={chartActiveDot} connectNulls />
              ))}
              {profileNames.map((name, i) => (
                <Area key={`${name}_neto`} type="monotone" dataKey={`${name}_neto`} name={multiProfile ? `${name} · neto` : "Neto"} stroke={netoColor(name)} strokeWidth={2} fill={`url(#gradNeto${i})`} dot={false} activeDot={chartActiveDot} connectNulls />
              ))}
            </AreaChart>
          ) : (
            <LineChart accessibilityLayer data={evolutionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="monthLabel" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} domain={evolutionDomain} />
              <Tooltip content={<ChartTooltip />} cursor={chartCursor} />
              {profileNames.map((name) => (
                <Line key={`${name}_bruto`} type="monotone" dataKey={`${name}_bruto`} name={multiProfile ? `${name} · bruto` : "Bruto"} stroke={brutoColor(name)} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, strokeWidth: 0, fill: brutoColor(name) }} activeDot={chartActiveDot} connectNulls />
              ))}
              {profileNames.map((name) => (
                <Line key={`${name}_neto`} type="monotone" dataKey={`${name}_neto`} name={multiProfile ? `${name} · neto` : "Neto"} stroke={netoColor(name)} strokeWidth={2.25} dot={{ r: 2.5, strokeWidth: 0, fill: netoColor(name) }} activeDot={chartActiveDot} connectNulls />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </ChartCard>

      {/* Del bruto al neto + resumen */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Del bruto al neto"
          description="Lo que cobras y lo que se queda por el camino, cada mes"
          height={260}
          exportTable={() => ({ headers: ["Mes", "Bruto", "Neto", "Deducciones"], rows: evolutionData.map((p) => [String(p.monthLabel), p.totalBruto as number, p.totalNeto as number, p.totalDeducciones as number]) })}
          legend={
            <div className="flex gap-5 text-xs text-muted-foreground">
              <LegendKey color={chartColors.primary} label="Neto" />
              <LegendKey color={chartColors.secondary} label="Deducciones" />
            </div>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart accessibilityLayer data={evolutionData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="monthLabel" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...chartAxis} tickFormatter={formatCompact} width={56} />
              <Tooltip content={<ChartTooltip />} cursor={chartBarCursor} />
              <Bar dataKey="totalNeto" name="Neto" stackId="s" fill={chartColors.primary} maxBarSize={22} />
              <Bar dataKey="totalDeducciones" name="Deducciones" stackId="s" fill={chartColors.secondary} fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <SectionCard title="Resumen del periodo" description={activeRangeLabel}>
          <dl className="space-y-3 text-sm">
            <SummaryRow label="Total bruto" value={formatCurrency(data.kpis.totalGrossYear)} strong />
            <SummaryRow label="Total neto" value={formatCurrency(data.kpis.totalNetYear)} strong accent />
            <SummaryRow label="Retenido" value={formatCurrency(data.kpis.totalGrossYear - data.kpis.totalNetYear)} />
            <div className="border-t border-border" />
            <SummaryRow label="Nóminas" value={String(data.kpis.totalPayslips)} />
            <SummaryRow label="Pagas extra" value={data.kpis.extrasCount > 0 ? `${data.kpis.extrasCount} · ${formatCurrency(data.kpis.extrasTotalNet)} netos` : "—"} />
            <SummaryRow label="IRPF medio" value={formatCurrency(data.kpis.avgIrpf)} />
          </dl>
          <div className="mt-5 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">De cada 100 € brutos te llegan</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
              {(retentionRate).toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} €
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary-500 dark:bg-primary" style={{ width: `${Math.min(retentionRate, 100)}%` }} />
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Devengos y deducciones */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {devengos.length > 0 && (
          <SectionCard title="Devengos" description="Reparto medio de lo que cobras">
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <div className="relative size-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart accessibilityLayer>
                    <Pie data={devengos} dataKey="average" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
                      {devengos.map((_, i) => <Cell key={i} fill={chartPalette[i % chartPalette.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number, name: string) => [formatCurrency(value), name]} {...chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] text-muted-foreground">Media bruta</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatCompact(devengosTotal)}</span>
                </div>
              </div>
              <ul className="w-full space-y-2">
                {devengos.map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2 text-sm">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: chartPalette[i % chartPalette.length] }} />
                    <span className="truncate text-muted-foreground">{c.name}</span>
                    <span className="ml-auto font-medium tabular-nums text-foreground">{formatCurrency(c.average)}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                      {devengosTotal ? formatPct((c.average / devengosTotal) * 100).replace(",0 %", " %") : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </SectionCard>
        )}

        {deducciones.length > 0 && (
          <SectionCard title="Deducciones" description="Media mensual por concepto">
            <ul className="space-y-3.5">
              {deducciones.map((c) => {
                const max = deducciones[0]?.average || 1;
                const isIrpf = isIrpfConcept({ name: c.name, category: "deduccion" });
                return (
                  <li key={c.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{c.name}</span>
                      <span className="font-medium tabular-nums text-foreground">{formatCurrency(c.average)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", isIrpf ? "bg-amber-400" : "bg-brand-navy/60 dark:bg-slate-400/70")} style={{ width: `${(c.average / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      </div>

      {/* IRPF y retención */}
      {irpfSeries.length > 1 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="IRPF"
            description="Retención mensual y tipo efectivo"
            height={240}
            exportTable={() => ({ headers: ["Mes", "IRPF", "Tipo efectivo (%)"], rows: irpfData.map((e) => [e.monthLabel, e.amount, e.rate]) })}
            legend={
              <div className="flex gap-5 text-xs text-muted-foreground">
                <LegendKey color={chartColors.tax} label="Importe" />
                <LegendKey color={chartColors.secondary} label="Tipo (%)" line />
              </div>
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart accessibilityLayer data={irpfData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="monthLabel" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis yAxisId="left" {...chartAxis} tickFormatter={formatCompact} width={52} />
                <YAxis yAxisId="right" orientation="right" {...chartAxis} tickFormatter={(v: number) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`} width={48} domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip content={<ChartTooltip valueFormatter={(v) => (v < 100 ? formatPct(v) : formatCurrency(v))} />} cursor={chartBarCursor} />
                <Bar yAxisId="left" dataKey="amount" name="Importe" fill={chartColors.tax} fillOpacity={0.8} radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="rate" name="Tipo" stroke={chartColors.secondary} strokeWidth={2} dot={false} activeDot={chartActiveDot} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Retención neta"
            description="Porcentaje del bruto que te llega"
            height={240}
            exportTable={() => ({ headers: ["Mes", "Neto sobre bruto (%)"], rows: retentionData.map((e) => [e.monthLabel, e.retentionRate]) })}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart accessibilityLayer data={retentionData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRetention" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="monthLabel" {...chartAxis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...chartAxis} domain={["dataMin - 2", "dataMax + 2"]} tickFormatter={(v) => `${Math.round(v)}%`} width={44} />
                <Tooltip content={<ChartTooltip valueFormatter={formatPct} />} cursor={chartCursor} />
                <Area type="monotone" dataKey="retentionRate" name="Retención" stroke={chartColors.primary} strokeWidth={2} fill="url(#gradRetention)" dot={false} activeDot={chartActiveDot} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Resumen anual */}
      {data.annualSummaries.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Resumen anual</h2>
              <p className="text-sm text-muted-foreground">Totales, pagas extra y proyección por año</p>
            </div>
            {data.annualSummaries.length > 1 && (
              <Select value={selectedYear ? String(selectedYear) : "all"} onValueChange={(v) => setSelectedYear(v === "all" || v === null ? null : Number(v))}>
                <SelectTrigger size="sm" className="w-auto">
                  <SelectValue>{(v: string) => (v === "all" ? "Todos los años" : v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los años</SelectItem>
                  {data.annualSummaries.map((s) => (
                    <SelectItem key={s.year} value={String(s.year)}>{s.year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {summaries.map((s) => (
              <SectionCard key={s.year}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-serif-accent text-3xl leading-none text-foreground">{s.year}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {s.months} {s.months === 1 ? "nómina" : "nóminas"}
                      {s.pagasExtra > 0 && ` · ${s.pagasExtra} ${s.pagasExtra === 1 ? "paga extra" : "pagas extra"}`}
                    </p>
                  </div>
                  <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary-700 dark:text-primary">
                    Te llega el {formatPct(s.retentionRate)}
                  </Badge>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                  <YearMetric label="Bruto" value={formatCurrency(s.totalGross)} />
                  <YearMetric label="Neto" value={formatCurrency(s.totalNet)} accent />
                  <YearMetric label="Deducciones" value={formatCurrency(s.totalDeductions)} />
                  <YearMetric label="IRPF" value={formatCurrency(s.totalIrpf)} />
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <SummaryRow label="Media bruta / mes" value={formatCurrency(s.avgMonthlyGross)} />
                  <SummaryRow label="Media neta / mes" value={formatCurrency(s.avgMonthlyNet)} />
                  {s.pagasExtra > 0 && (
                    <>
                      <SummaryRow label={<span className="inline-flex items-center gap-1"><Gift className="size-3.5" /> Extras bruto</span>} value={formatCurrency(s.extraGross)} />
                      <SummaryRow label="Extras neto" value={formatCurrency(s.extraNet)} />
                    </>
                  )}
                  {s.months < 12 && (
                    <>
                      <SummaryRow label="Proyección bruta" value={formatCurrency(s.projectedAnnualGross)} />
                      <SummaryRow label="Proyección neta" value={formatCurrency(s.projectedAnnualNet)} />
                    </>
                  )}
                </dl>
              </SectionCard>
            ))}
          </div>
        </section>
      )}

      {/* Conceptos */}
      {data.conceptBreakdown.length > 0 && (
        <SectionCard className="mt-10" title="Todos los conceptos" description={`${plural(data.conceptBreakdown.length, "concepto detectado", "conceptos detectados")} en el periodo`} flush>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead label="Concepto" column="name" sort={conceptSort} onSort={handleConceptSort} className="pl-5" />
                <SortableHead label="Tipo" column="category" sort={conceptSort} onSort={handleConceptSort} />
                <SortableHead label="Media" column="average" sort={conceptSort} onSort={handleConceptSort} align="right" />
                <SortableHead label="Total" column="total" sort={conceptSort} onSort={handleConceptSort} align="right" />
                <SortableHead label="Apariciones" column="count" sort={conceptSort} onSort={handleConceptSort} align="right" className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedConceptBreakdown.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="py-3 pl-5 font-medium text-foreground">{c.name}</TableCell>
                  <TableCell className="py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", c.category === "devengo" ? "bg-emerald-500" : c.category === "deduccion" ? "bg-red-500" : "bg-muted-foreground")} />
                      {getConceptCategoryLabel(c.category)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-right tabular-nums text-foreground">{formatCurrency(c.average)}</TableCell>
                  <TableCell className="py-3 text-right tabular-nums text-foreground">{formatCurrency(c.total)}</TableCell>
                  <TableCell className="py-3 pr-5 text-right tabular-nums text-muted-foreground">{c.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────
function MonthRangeSelect({ label, value, placeholder, options, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" || v === null ? "" : v)} disabled={options.length === 0}>
      <SelectTrigger size="sm" className="min-w-28 bg-card" aria-label={label}>
        <SelectValue placeholder={placeholder}>{(v: string) => (v === "none" ? placeholder : formatMonthLabel(v))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{placeholder}</SelectItem>
        {options.map((month) => (
          <SelectItem key={month} value={month}>{formatMonthLabel(month)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortableHead({ label, column, sort, onSort, align = "left", className }: {
  label: string;
  column: ConceptSortColumn;
  sort: { column: ConceptSortColumn; direction: SortDirection };
  onSort: (column: ConceptSortColumn) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.column === column;
  return (
    <TableHead
      className={cn(align === "right" && "text-right", className)}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          align === "right" && "w-full justify-end",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <SortIndicator active={active} direction={sort.direction} />
      </button>
    </TableHead>
  );
}

function SummaryRow({ label, value, strong, accent }: { label: ReactNode; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold" : "font-medium", accent ? "text-primary-700 dark:text-primary" : "text-foreground")}>{value}</dd>
    </div>
  );
}

function YearMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-semibold tabular-nums", accent ? "text-primary-700 dark:text-primary" : "text-foreground")}>{value}</p>
    </div>
  );
}

function LegendKey({ color, label, dashed, line }: { color: string; label: string; dashed?: boolean; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed || line ? (
        <svg width="14" height="4" aria-hidden="true">
          <line x1="0" y1="2" x2="14" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
        </svg>
      ) : (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {label}
    </span>
  );
}

export default function DashboardPage() {
  return (
    <Providers>
      <DashboardView />
    </Providers>
  );
}
