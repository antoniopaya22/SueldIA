import { useEffect, useMemo, useRef, useState } from "react";
import { transactionsHref } from "../lib/transaction-filters";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarRange, Download, RefreshCcw, Scale, SlidersHorizontal, Wallet, X,
} from "lucide-react";
import {
  getAccounts, getCategories, getFinanceAnalytics,
  type FinanceAnalyticsCategoryItem, type FinanceAnalyticsFilters, type FinanceAnalyticsGroupItem,
} from "../lib/api";
import { Providers } from "./Providers";
import { formatCurrency, formatMonthLabel, formatPct } from "../lib/format";
import { EmptyState } from "./ui/EmptyState";
import {
  PageHeader, StatCard, StatGrid, SectionCard, Segmented, PageHeaderSkeleton, StatCardSkeleton, ChartCardSkeleton,
  chartAxis, chartGrid, chartCursor, chartBarCursor, chartActiveDot, chartColors, type SegmentedOption,
} from "./app";
import {
  AccountSelect, ChartEmpty, ChartLegend, FilterSelect, LimitSelect, PieTooltip, RankedList, SeriesTooltip,
  adaptiveColor, flowColors, paletteColor, presetRange, rangeLabel, shortenLabel,
  tickFormatter as fmtTick, valueFormatter as fmtValue, type RangePreset, type ValueMode,
} from "./finance/finance-ui";
import { AnalyticsPanel, ExpandedPanelDialog, MatrixHeatmap, type PanelConfig } from "./finance/AnalyticsPanel";
import { AnalyticsCustomizeSheet } from "./finance/AnalyticsCustomizeSheet";
import { PaceChart } from "./finance/charts/PaceChart";
import { CalendarHeatmap } from "./finance/charts/CalendarHeatmap";
import { TreemapChart } from "./finance/charts/TreemapChart";
import { SankeyChart } from "./finance/charts/SankeyChart";
import { WaterfallChart } from "./finance/charts/WaterfallChart";
import { YearOverYearChart } from "./finance/charts/YearOverYearChart";
import { BudgetVsActualChart } from "./finance/charts/BudgetVsActualChart";
import { AmountsChart } from "./finance/charts/AmountsChart";
import { SmallMultiples } from "./finance/charts/SmallMultiples";
import { AnalyticsViewsMenu } from "./finance/AnalyticsViewsMenu";
import { usePreference } from "../hooks/use-preference";
import {
  DEFAULT_PANEL_SETTINGS, normalizeLayout, normalizePanelSettings, normalizeViews,
  type AnalyticsView, type LayoutEntry, type PanelKey, type PanelSettings,
} from "../lib/analytics-settings";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

// Los paneles que son un gráfico con controles (todos menos las "lecturas rápidas", que es una tarjeta aparte).
type ChartPanelKey = Exclude<PanelKey, "insights">;

// ─── Tipos de controles ─────────────────────────────────────────
type PeriodPreset = RangePreset | "custom";
type TrendMetric = "all" | "income" | "expenses" | "net" | "count" | "savingsRate";
type ChartView = "bars" | "area" | "line";
type FlowType = "expense" | "income";
type Scope = "category" | "group";
type RankValue = "total" | "count" | "average";
type WeekdayMetric = "expense" | "income" | "net" | "count";
type AccountMetric = "balance" | "income" | "expenses" | "net" | "count";
type CumulativeMetric = "net" | "income" | "expenses" | "count";
type EfficiencyMetric = "savingsRate" | "avgMovement" | "netPerMovement" | "count";

const DEFAULT_PRESET: RangePreset = "12m";

const PRESET_OPTIONS: SegmentedOption<PeriodPreset>[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
  { value: "ytd", label: "Año" },
  { value: "all", label: "Todo" },
];
const FLOW_OPTIONS: SegmentedOption<FlowType>[] = [
  { value: "expense", label: "Gasto" },
  { value: "income", label: "Ingreso" },
];
const SCOPE_OPTIONS: SegmentedOption<Scope>[] = [
  { value: "category", label: "Categoría" },
  { value: "group", label: "Grupo" },
];
const RANK_VALUE_OPTIONS: SegmentedOption<RankValue>[] = [
  { value: "total", label: "Importe" },
  { value: "count", label: "Frecuencia" },
  { value: "average", label: "Media" },
];

const RANK_VALUE_LABEL: Record<RankValue, string> = { total: "Importe", count: "Movimientos", average: "Importe medio" };

function rankValue(total: number, count: number, mode: RankValue): number {
  if (mode === "count") return count;
  if (mode === "average") return total / Math.max(count, 1);
  return total;
}

interface CompareDatum {
  key: string;
  label: string;
  shortLabel: string;
  incomeTotal: number;
  expenseTotal: number;
  incomeCount: number;
  expenseCount: number;
  incomeValue: number;
  expenseValue: number;
}

// ─── Skeleton ───────────────────────────────────────────────────
function AnalyticsSkeleton() {
  return (
    <div>
      <PageHeaderSkeleton />
      <StatGrid>
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </StatGrid>
      <ChartCardSkeleton className="mt-10" height={300} />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartCardSkeleton height={260} />
        <ChartCardSkeleton height={260} />
      </div>
    </div>
  );
}

function Insight({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 truncate text-lg font-semibold tracking-tight text-foreground" title={value}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// ─── Vista ──────────────────────────────────────────────────────
function FinanceAnalyticsView() {
  const defaultRange = useMemo(() => presetRange(DEFAULT_PRESET), []);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PRESET);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [accountId, setAccountId] = useState<number | undefined>();
  const [groupId, setGroupId] = useState<number | undefined>();
  const [categoryId, setCategoryId] = useState<number | undefined>();
  const [expandedPanel, setExpandedPanel] = useState<ChartPanelKey | null>(null);

  // Lo que cada panel recuerda (tipo de gráfico, métrica, "Top N"): se guarda en la cuenta y se valida al leerlo.
  const [storedSettings, setStoredSettings] = usePreference<unknown>("analytics-settings", DEFAULT_PANEL_SETTINGS);
  const settings = useMemo(() => normalizePanelSettings(storedSettings), [storedSettings]);
  const setting = <K extends keyof PanelSettings>(key: K) => (value: PanelSettings[K]) =>
    setStoredSettings((prev: unknown) => ({ ...normalizePanelSettings(prev), [key]: value }));
  const trendMetric = settings.trendMetric;
  const setTrendMetric = setting("trendMetric");
  const trendView = settings.trendView;
  const setTrendView = setting("trendView");
  const distributionMetric = settings.distributionMetric;
  const setDistributionMetric = setting("distributionMetric");
  const distributionScope = settings.distributionScope;
  const setDistributionScope = setting("distributionScope");
  const distributionView = settings.distributionView;
  const setDistributionView = setting("distributionView");
  const distributionValue = settings.distributionValue;
  const setDistributionValue = setting("distributionValue");
  const distributionLimit = settings.distributionLimit;
  const setDistributionLimit = setting("distributionLimit");
  const payeeMetric = settings.payeeMetric;
  const setPayeeMetric = setting("payeeMetric");
  const payeeValue = settings.payeeValue;
  const setPayeeValue = setting("payeeValue");
  const payeeLimit = settings.payeeLimit;
  const setPayeeLimit = setting("payeeLimit");
  const stackGrouping = settings.stackGrouping;
  const setStackGrouping = setting("stackGrouping");
  const stackMetric = settings.stackMetric;
  const setStackMetric = setting("stackMetric");
  const stackView = settings.stackView;
  const setStackView = setting("stackView");
  const stackLimit = settings.stackLimit;
  const setStackLimit = setting("stackLimit");
  const weekdayMetric = settings.weekdayMetric;
  const setWeekdayMetric = setting("weekdayMetric");
  const weekdayView = settings.weekdayView;
  const setWeekdayView = setting("weekdayView");
  const accountMetric = settings.accountMetric;
  const setAccountMetric = setting("accountMetric");
  const accountView = settings.accountView;
  const setAccountView = setting("accountView");
  const accountLimit = settings.accountLimit;
  const setAccountLimit = setting("accountLimit");
  const cumulativeMetric = settings.cumulativeMetric;
  const setCumulativeMetric = setting("cumulativeMetric");
  const cumulativeView = settings.cumulativeView;
  const setCumulativeView = setting("cumulativeView");
  const efficiencyMetric = settings.efficiencyMetric;
  const setEfficiencyMetric = setting("efficiencyMetric");
  const compareScope = settings.compareScope;
  const setCompareScope = setting("compareScope");
  const compareValue = settings.compareValue;
  const setCompareValue = setting("compareValue");
  const compareLimit = settings.compareLimit;
  const setCompareLimit = setting("compareLimit");
  const matrixScope = settings.matrixScope;
  const setMatrixScope = setting("matrixScope");
  const matrixMetric = settings.matrixMetric;
  const setMatrixMetric = setting("matrixMetric");
  const matrixLimit = settings.matrixLimit;
  const setMatrixLimit = setting("matrixLimit");
  const calendarMetric = settings.calendarMetric;
  const setCalendarMetric = setting("calendarMetric");
  const treemapMetric = settings.treemapMetric;
  const setTreemapMetric = setting("treemapMetric");
  const sankeyLimit = settings.sankeyLimit;
  const setSankeyLimit = setting("sankeyLimit");
  const waterfallLimit = settings.waterfallLimit;
  const setWaterfallLimit = setting("waterfallLimit");
  const yoyMetric = settings.yoyMetric;
  const setYoyMetric = setting("yoyMetric");
  const amountsMetric = settings.amountsMetric;
  const setAmountsMetric = setting("amountsMetric");
  const amountsView = settings.amountsView;
  const setAmountsView = setting("amountsView");
  const multiplesMetric = settings.multiplesMetric;
  const setMultiplesMetric = setting("multiplesMetric");
  const multiplesLimit = settings.multiplesLimit;
  const setMultiplesLimit = setting("multiplesLimit");
  const budgetLimit = settings.budgetLimit;
  const setBudgetLimit = setting("budgetLimit");

  const { data: accounts = [], isLoading: loadingAccounts, error: accountsError } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: categoryGroups = [], isLoading: loadingCategories, error: categoriesError } = useQuery({ queryKey: ["categories"], queryFn: getCategories });

  const analyticsFilters = useMemo<FinanceAnalyticsFilters>(() => ({
    from: from || undefined,
    to: to || undefined,
    accountId,
    groupId,
    categoryId,
  }), [from, to, accountId, groupId, categoryId]);

  const { data: analytics, isLoading: loadingAnalytics, isFetching, error: analyticsError, refetch } = useQuery({
    queryKey: ["finance-analytics", analyticsFilters],
    queryFn: () => getFinanceAnalytics(analyticsFilters),
  });

  const flatCategories = useMemo(
    () => categoryGroups.flatMap((group) => group.categories.map((category) => ({ ...category, groupName: group.name }))),
    [categoryGroups],
  );

  // La categoría elegida debe pertenecer al grupo filtrado.
  useEffect(() => {
    if (!categoryId) return;
    const stillVisible = flatCategories.some((c) => c.id === categoryId && (!groupId || c.groupId === groupId));
    if (!stillVisible) setCategoryId(undefined);
  }, [categoryId, flatCategories, groupId]);

  // El radar y la tarta no admiten valores negativos.
  useEffect(() => {
    if (weekdayMetric === "net" && weekdayView === "radar") setWeekdayView("bars");
  }, [weekdayMetric, weekdayView]);
  useEffect(() => {
    if (accountMetric === "net" && accountView === "donut") setAccountView("bars");
  }, [accountMetric, accountView]);

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedGroup = categoryGroups.find((g) => g.id === groupId);
  const selectedCategory = flatCategories.find((c) => c.id === categoryId);

  const hasCustomDateRange = from !== defaultRange.from || to !== defaultRange.to;
  const hasFiltersApplied = hasCustomDateRange || Boolean(accountId) || Boolean(groupId) || Boolean(categoryId);

  // ─── Datos derivados ──────────────────────────────────────────
  const monthlyChartData = useMemo(() => (analytics?.monthly ?? []).map((item) => ({
    ...item,
    label: formatMonthLabel(item.month),
    count: item.transactionCount,
    savingsRate: item.income > 0 ? (item.net / item.income) * 100 : 0,
    avgMovement: item.transactionCount > 0 ? (item.income + item.expenses) / item.transactionCount : 0,
    netPerMovement: item.transactionCount > 0 ? item.net / item.transactionCount : 0,
  })), [analytics]);

  const cumulativeChartData = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let net = 0;
    let count = 0;
    return monthlyChartData.map((item) => {
      income += item.income;
      expenses += item.expenses;
      net += item.net;
      count += item.transactionCount;
      return { ...item, cumulativeIncome: income, cumulativeExpenses: expenses, cumulativeNet: net, cumulativeCount: count };
    });
  }, [monthlyChartData]);

  const distributionData = useMemo(() => {
    const source: Array<FinanceAnalyticsCategoryItem | FinanceAnalyticsGroupItem> =
      distributionScope === "category" ? analytics?.categories ?? [] : analytics?.groups ?? [];
    const ranked = source
      .filter((item) => item.type === distributionMetric)
      .map((item) => {
        const isCategory = distributionScope === "category";
        const label = isCategory ? (item as FinanceAnalyticsCategoryItem).categoryName : (item as FinanceAnalyticsGroupItem).groupName;
        // Sin categoría/grupo el bucket es "sin categoría" (null): enlaza a ese filtro.
        const id = isCategory ? (item as FinanceAnalyticsCategoryItem).categoryId : (item as FinanceAnalyticsGroupItem).groupId;
        const href = transactionsHref({
          ...(id === null ? { uncategorized: true } : isCategory ? { categoryId: id } : { groupId: id }),
          type: distributionMetric,
          from: from || undefined,
          to: to || undefined,
          accountId,
          cleared: "true", // la analítica solo cuenta lo liquidado: así el total del enlace coincide
        });
        return {
          key: item.bucketKey,
          href,
          label,
          parentLabel: isCategory ? (item as FinanceAnalyticsCategoryItem).groupName : null,
          count: item.count,
          value: rankValue(item.total, item.count, distributionValue),
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, distributionLimit);
    const totalValue = ranked.reduce((sum, item) => sum + item.value, 0);
    return ranked.map((item, index) => ({ ...item, share: totalValue > 0 ? (item.value / totalValue) * 100 : 0, color: paletteColor(index) }));
  }, [accountId, analytics, distributionLimit, distributionMetric, distributionScope, distributionValue, from, to]);

  const payeeData = useMemo(() => (analytics?.payees ?? [])
    .filter((item) => item.type === payeeMetric)
    .map((item) => ({
      key: item.bucketKey,
      label: item.payee,
      count: item.count,
      value: rankValue(item.total, item.count, payeeValue),
      // "Sin beneficiario" no se puede buscar por texto.
      href: item.payee === "Sin beneficiario"
        ? undefined
        : transactionsHref({ search: item.payee, type: payeeMetric, from: from || undefined, to: to || undefined, accountId, cleared: "true" }),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, payeeLimit), [accountId, analytics, from, payeeLimit, payeeMetric, payeeValue, to]);

  const stackTrend = useMemo(() => {
    const source: Array<FinanceAnalyticsCategoryItem | FinanceAnalyticsGroupItem> =
      stackGrouping === "category" ? analytics?.categories ?? [] : analytics?.groups ?? [];
    const series = source
      .filter((item) => item.type === stackMetric)
      .slice(0, stackLimit)
      .map((item, index) => ({
        key: item.bucketKey,
        label: stackGrouping === "category" ? (item as FinanceAnalyticsCategoryItem).categoryName : (item as FinanceAnalyticsGroupItem).groupName,
        color: paletteColor(index),
      }));
    const buckets = stackGrouping === "category" ? analytics?.monthlyCategories ?? [] : analytics?.monthlyGroups ?? [];
    const keys = new Set(series.map((s) => s.key));
    const rows = new Map<string, Record<string, number | string>>();
    for (const month of analytics?.monthly ?? []) {
      const row: Record<string, number | string> = { month: month.month, label: formatMonthLabel(month.month) };
      for (const s of series) row[s.key] = 0;
      rows.set(month.month, row);
    }
    for (const item of buckets) {
      if (item.type !== stackMetric || !keys.has(item.bucketKey)) continue;
      const row = rows.get(item.month);
      if (row) row[item.bucketKey] = item.total;
    }
    return { data: Array.from(rows.values()), series };
  }, [analytics, stackGrouping, stackLimit, stackMetric]);

  const weekdayChartData = useMemo(() => (analytics?.weekdays ?? []).map((item) => ({
    ...item,
    label: item.weekdayLabel,
    value: weekdayMetric === "expense" ? item.expenses
      : weekdayMetric === "income" ? item.income
        : weekdayMetric === "count" ? item.transactionCount
          : item.net,
  })), [analytics, weekdayMetric]);

  const accountChartData = useMemo(() => {
    const metricValue = (a: { balance: number; income: number; expenses: number; net: number; transactionCount: number }) =>
      accountMetric === "balance" ? a.balance
        : accountMetric === "income" ? a.income
          : accountMetric === "expenses" ? a.expenses
            : accountMetric === "count" ? a.transactionCount
              : a.net;
    return [...(analytics?.accounts ?? [])]
      .sort((a, b) => Math.abs(metricValue(b)) - Math.abs(metricValue(a)))
      .slice(0, accountLimit)
      .map((item, index) => ({
        ...item,
        key: String(item.accountId),
        label: item.accountName,
        value: metricValue(item),
        color: adaptiveColor(item.color, paletteColor(index)),
      }));
  }, [accountLimit, accountMetric, analytics]);

  const efficiencyChartData = useMemo(() => monthlyChartData.map((item) => ({
    ...item,
    displayMetric: efficiencyMetric === "savingsRate" ? item.savingsRate
      : efficiencyMetric === "avgMovement" ? item.avgMovement
        : efficiencyMetric === "netPerMovement" ? item.netPerMovement
          : item.count,
  })), [efficiencyMetric, monthlyChartData]);

  const compareData = useMemo(() => {
    const source: Array<FinanceAnalyticsCategoryItem | FinanceAnalyticsGroupItem> =
      compareScope === "category" ? analytics?.categories ?? [] : analytics?.groups ?? [];
    const map = new Map<string, CompareDatum>();
    for (const item of source) {
      const isCategory = compareScope === "category";
      const cat = item as FinanceAnalyticsCategoryItem;
      const grp = item as FinanceAnalyticsGroupItem;
      const key = isCategory ? `category:${cat.categoryId ?? cat.categoryName}` : `group:${grp.groupId ?? grp.groupName}`;
      const label = isCategory ? cat.categoryName : grp.groupName;
      const current = map.get(key) ?? {
        key, label, shortLabel: shortenLabel(label, 18),
        incomeTotal: 0, expenseTotal: 0, incomeCount: 0, expenseCount: 0, incomeValue: 0, expenseValue: 0,
      };
      if (item.type === "income") {
        current.incomeTotal += item.total;
        current.incomeCount += item.count;
      } else {
        current.expenseTotal += item.total;
        current.expenseCount += item.count;
      }
      map.set(key, current);
    }
    return Array.from(map.values())
      .map((item) => ({
        ...item,
        incomeValue: rankValue(item.incomeTotal, item.incomeCount, compareValue),
        expenseValue: rankValue(item.expenseTotal, item.expenseCount, compareValue),
      }))
      .sort((a, b) => (b.incomeValue + b.expenseValue) - (a.incomeValue + a.expenseValue))
      .slice(0, compareLimit);
  }, [analytics, compareLimit, compareScope, compareValue]);

  const matrixData = useMemo(() => {
    const ranking: Array<FinanceAnalyticsCategoryItem | FinanceAnalyticsGroupItem> =
      matrixScope === "category" ? analytics?.categories ?? [] : analytics?.groups ?? [];
    const monthly = matrixScope === "category" ? analytics?.monthlyCategories ?? [] : analytics?.monthlyGroups ?? [];
    const byKey = new Map<string, number>();
    for (const item of monthly) {
      if (item.type === matrixMetric) byKey.set(`${item.bucketKey}|${item.month}`, item.total);
    }
    const months = (analytics?.monthly ?? []).map((m) => ({ month: m.month, label: formatMonthLabel(m.month) }));
    const rows = ranking
      .filter((item) => item.type === matrixMetric)
      .slice(0, matrixLimit)
      .map((item) => {
        const values = months.map((m) => ({ ...m, value: byKey.get(`${item.bucketKey}|${m.month}`) ?? 0 }));
        return {
          key: item.bucketKey,
          label: matrixScope === "category" ? (item as FinanceAnalyticsCategoryItem).categoryName : (item as FinanceAnalyticsGroupItem).groupName,
          total: values.reduce((s, v) => s + v.value, 0),
          values,
        };
      });
    return { months, rows };
  }, [analytics, matrixLimit, matrixMetric, matrixScope]);

  const topWeekday = useMemo(
    () => [...weekdayChartData].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0],
    [weekdayChartData],
  );

  const loading = loadingAccounts || loadingCategories || loadingAnalytics;
  const error = accountsError || categoriesError || analyticsError;

  const applyPreset = (preset: PeriodPreset) => {
    if (preset === "custom") return;
    const range = presetRange(preset);
    setPeriodPreset(preset);
    setFrom(range.from);
    setTo(range.to);
  };

  const resetFilters = () => {
    setAccountId(undefined);
    setGroupId(undefined);
    setCategoryId(undefined);
    applyPreset(DEFAULT_PRESET);
  };

  // ─── Diseño de la página y vistas guardadas (se guardan en la cuenta) ──
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [storedLayout, setStoredLayout, layoutPref] = usePreference<unknown>("analytics-layout", null);
  const layout = useMemo(() => normalizeLayout(storedLayout), [storedLayout]);
  const [storedViews, setStoredViews] = usePreference<unknown>("analytics-views", []);
  const views = useMemo(() => normalizeViews(storedViews), [storedViews]);
  const [defaultViewId, setDefaultViewId, defaultViewPref] = usePreference<string | null>("analytics-default-view", null);

  const applyView = (view: AnalyticsView) => {
    setAccountId(view.accountId);
    setGroupId(view.groupId);
    setCategoryId(view.categoryId);
    if (view.preset === "custom") {
      setPeriodPreset("custom");
      setFrom(view.from ?? defaultRange.from);
      setTo(view.to ?? defaultRange.to);
    } else {
      applyPreset(view.preset);
    }
  };

  const saveCurrentView = (name: string) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const custom = periodPreset === "custom";
    setStoredViews([
      ...views,
      { id, name, preset: periodPreset, from: custom ? from : undefined, to: custom ? to : undefined, accountId, groupId, categoryId },
    ]);
    toast.success(`Vista «${name}» guardada`);
  };

  const deleteView = (id: string) => {
    setStoredViews(views.filter((v) => v.id !== id));
    if (defaultViewId === id) setDefaultViewId(null);
  };

  const activeViewId = views.find((v) =>
    v.accountId === accountId && v.groupId === groupId && v.categoryId === categoryId && v.preset === periodPreset &&
    (v.preset !== "custom" || (v.from === from && v.to === to)),
  )?.id ?? null;

  // La vista por defecto se aplica una sola vez, al entrar, cuando las preferencias ya están en el estado.
  const defaultViewApplied = useRef(false);
  useEffect(() => {
    if (defaultViewApplied.current || !defaultViewPref.synced) return;
    defaultViewApplied.current = true;
    const view = views.find((v) => v.id === defaultViewId);
    if (view) applyView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultViewPref.synced]);

  if (loading) return <AnalyticsSkeleton />;

  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudo cargar la analítica financiera" description="Vuelve a intentarlo en unos segundos.">
        <Button onClick={() => refetch()} className="gap-1.5">
          <RefreshCcw className="size-4" /> Reintentar
        </Button>
      </EmptyState>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Analítica" accent="financiera." description="Explora tus ingresos y gastos por periodo, cuenta y categoría." />
        <EmptyState
          icon={Wallet}
          title="Aún no hay datos financieros"
          description="Importa tu CSV de YNAB o crea cuentas y movimientos para activar la analítica."
          actionLabel="Importar datos"
          actionHref="/app/import"
          actionIcon={Download}
        />
      </>
    );
  }

  if (!analytics) return null;

  const { summary } = analytics;
  const hasTransactions = summary.transactionCount > 0;

  // ─── Modos de valor ───────────────────────────────────────────
  const trendMode: ValueMode = trendMetric === "count" ? "count" : trendMetric === "savingsRate" ? "percent" : "currency";
  const cumulativeMode: ValueMode = cumulativeMetric === "count" ? "count" : "currency";
  const distributionMode: ValueMode = distributionValue === "count" ? "count" : "currency";
  const payeeMode: ValueMode = payeeValue === "count" ? "count" : "currency";
  const weekdayMode: ValueMode = weekdayMetric === "count" ? "count" : "currency";
  const accountMode: ValueMode = accountMetric === "count" ? "count" : "currency";
  const efficiencyMode: ValueMode = efficiencyMetric === "savingsRate" ? "percent" : efficiencyMetric === "count" ? "count" : "currency";
  const compareMode: ValueMode = compareValue === "count" ? "count" : "currency";

  const chartHeight = (expanded: boolean, base = 300) => (expanded ? 520 : base);

  // ─── Gráficos ─────────────────────────────────────────────────
  const TREND_SERIES: Record<Exclude<TrendMetric, "all">, { key: string; label: string; color: string }> = {
    income: { key: "income", label: "Ingresos", color: flowColors.income },
    expenses: { key: "expenses", label: "Gastos", color: flowColors.expense },
    net: { key: "net", label: "Flujo neto", color: flowColors.net },
    count: { key: "count", label: "Movimientos", color: flowColors.count },
    savingsRate: { key: "savingsRate", label: "% de ahorro", color: flowColors.rate },
  };

  const renderTrendChart = (expanded: boolean) => {
    const format = fmtValue(trendMode);
    const all = trendMetric === "all";
    const single = all ? null : TREND_SERIES[trendMetric];
    // Recharts no recorre Fragments: ejes y series van como arrays con key.
    const axes = [
      <CartesianGrid key="grid" {...chartGrid} />,
      <XAxis key="x" dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />,
      <YAxis key="y" {...chartAxis} tickFormatter={fmtTick(trendMode)} width={56} />,
    ];
    const legend = all
      ? [
        { color: flowColors.income, label: "Ingresos" },
        { color: flowColors.expense, label: "Gastos" },
        { color: flowColors.net, label: "Flujo neto", line: trendView === "bars" },
      ]
      : [{ color: single!.color, label: single!.label, line: trendView === "line" }];

    let chart;
    if (trendView === "line") {
      chart = (
        <ComposedChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {axes}
          <Tooltip content={<SeriesTooltip format={format} />} cursor={chartCursor} />
          {all ? [
            <Line key="income" type="monotone" dataKey="income" name="Ingresos" stroke={flowColors.income} strokeWidth={2} dot={false} activeDot={chartActiveDot} />,
            <Line key="expenses" type="monotone" dataKey="expenses" name="Gastos" stroke={flowColors.expense} strokeWidth={2} dot={false} activeDot={chartActiveDot} />,
            <Line key="net" type="monotone" dataKey="net" name="Flujo neto" stroke={flowColors.net} strokeWidth={2} dot={false} activeDot={chartActiveDot} />,
          ] : (
            <Line type="monotone" dataKey={single!.key} name={single!.label} stroke={single!.color} strokeWidth={2} dot={false} activeDot={chartActiveDot} />
          )}
        </ComposedChart>
      );
    } else if (trendView === "area") {
      chart = (
        <AreaChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {axes}
          <Tooltip content={<SeriesTooltip format={format} />} cursor={chartCursor} />
          {all ? [
            <Area key="income" type="monotone" dataKey="income" name="Ingresos" stroke={flowColors.income} fill={flowColors.income} fillOpacity={0.12} strokeWidth={2} activeDot={chartActiveDot} />,
            <Area key="expenses" type="monotone" dataKey="expenses" name="Gastos" stroke={flowColors.expense} fill={flowColors.expense} fillOpacity={0.1} strokeWidth={2} activeDot={chartActiveDot} />,
            <Area key="net" type="monotone" dataKey="net" name="Flujo neto" stroke={flowColors.net} fill={flowColors.net} fillOpacity={0.1} strokeWidth={2} activeDot={chartActiveDot} />,
          ] : (
            <Area type="monotone" dataKey={single!.key} name={single!.label} stroke={single!.color} fill={single!.color} fillOpacity={0.14} strokeWidth={2} activeDot={chartActiveDot} />
          )}
        </AreaChart>
      );
    } else {
      chart = (
        <ComposedChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3}>
          {axes}
          <Tooltip content={<SeriesTooltip format={format} />} cursor={chartBarCursor} />
          {all ? [
            <Bar key="income" dataKey="income" name="Ingresos" fill={flowColors.income} radius={[4, 4, 0, 0]} maxBarSize={24} />,
            <Bar key="expenses" dataKey="expenses" name="Gastos" fill={flowColors.expense} fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={24} />,
            <Line key="net" type="monotone" dataKey="net" name="Flujo neto" stroke={flowColors.net} strokeWidth={2} dot={false} activeDot={chartActiveDot} />,
          ] : (
            <Bar dataKey={single!.key} name={single!.label} fill={single!.color} radius={[4, 4, 0, 0]} maxBarSize={32} />
          )}
        </ComposedChart>
      );
    }

    return (
      <>
        <div style={{ height: chartHeight(expanded, 320) }}>
          <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
        </div>
        <div className="mt-4"><ChartLegend items={legend} /></div>
      </>
    );
  };

  const renderCumulativeChart = (expanded: boolean) => {
    const key = cumulativeMetric === "income" ? "cumulativeIncome"
      : cumulativeMetric === "expenses" ? "cumulativeExpenses"
        : cumulativeMetric === "count" ? "cumulativeCount"
          : "cumulativeNet";
    const color = cumulativeMetric === "income" ? flowColors.income
      : cumulativeMetric === "expenses" ? flowColors.expense
        : cumulativeMetric === "count" ? flowColors.count
          : flowColors.net;
    const common = [
      <CartesianGrid key="grid" {...chartGrid} />,
      <XAxis key="x" dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />,
      <YAxis key="y" {...chartAxis} tickFormatter={fmtTick(cumulativeMode)} width={56} />,
      <Tooltip key="tt" content={<SeriesTooltip format={fmtValue(cumulativeMode)} />} cursor={chartCursor} />,
    ];
    return (
      <div style={{ height: chartHeight(expanded, 260) }}>
        <ResponsiveContainer width="100%" height="100%">
          {cumulativeView === "line" ? (
            <ComposedChart data={cumulativeChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              <Line type="monotone" dataKey={key} name="Acumulado" stroke={color} strokeWidth={2} dot={false} activeDot={chartActiveDot} />
            </ComposedChart>
          ) : (
            <AreaChart data={cumulativeChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {common}
              <Area type="monotone" dataKey={key} name="Acumulado" stroke={color} fill={color} fillOpacity={0.14} strokeWidth={2} activeDot={chartActiveDot} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  };

  const renderDistributionChart = (expanded: boolean) => {
    const format = fmtValue(distributionMode);
    if (distributionData.length === 0) {
      return <ChartEmpty message="No hay datos para esta combinación de variables." height={chartHeight(expanded, 260)} />;
    }
    if (distributionView === "bars") {
      return (
        <RankedList
          format={format}
          items={distributionData.map((d) => ({ key: d.key, label: d.label, sublabel: d.parentLabel, value: d.value, color: d.color, meta: formatPct(d.share), href: d.href }))}
        />
      );
    }
    const size = expanded ? 320 : 200;
    return (
      <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="mx-auto" style={{ width: size, height: size }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={distributionData} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
                {distributionData.map((d) => <Cell key={d.key} fill={d.color} />)}
              </Pie>
              <Tooltip content={<PieTooltip format={format} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 space-y-2">
          {distributionData.map((d) => (
            <li key={d.key} className="flex items-center gap-2 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <a href={d.href} className="min-w-0 flex-1 truncate rounded-sm text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50" title={`Ver movimientos de ${d.parentLabel ? `${d.label} · ${d.parentLabel}` : d.label}`}>{d.label}</a>
              <span className="text-xs tabular-nums text-muted-foreground">{formatPct(d.share)}</span>
              <span className="w-24 text-right font-medium tabular-nums text-foreground">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderPayeesChart = (expanded: boolean) => {
    if (payeeData.length === 0) {
      return <ChartEmpty message="No hay beneficiarios para esta combinación de variables." height={chartHeight(expanded, 260)} />;
    }
    const color = payeeMetric === "expense" ? flowColors.expense : flowColors.income;
    return (
      <RankedList
        format={fmtValue(payeeMode)}
        items={payeeData.map((p, i) => ({
          key: p.key,
          label: expanded ? p.label : shortenLabel(p.label, 30),
          href: p.href,
          value: p.value,
          color: i === 0 ? color : chartColors.quaternary,
          meta: payeeValue === "count" ? undefined : `${p.count} mov.`,
        }))}
      />
    );
  };

  const renderWeekdayChart = (expanded: boolean) => {
    const format = fmtValue(weekdayMode);
    if (weekdayChartData.every((item) => item.value === 0)) {
      return <ChartEmpty message="No hay patrón semanal para esta métrica con los filtros actuales." height={chartHeight(expanded, 260)} />;
    }
    const color = weekdayMetric === "income" ? flowColors.income
      : weekdayMetric === "expense" ? flowColors.expense
        : weekdayMetric === "net" ? flowColors.net
          : flowColors.count;
    return (
      <div style={{ height: chartHeight(expanded, 260) }}>
        <ResponsiveContainer width="100%" height="100%">
          {weekdayView === "radar" ? (
            <RadarChart data={weekdayChartData} outerRadius="74%">
              <PolarGrid stroke={chartColors.grid} />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
              <PolarRadiusAxis tick={false} axisLine={false} />
              <Tooltip content={<SeriesTooltip format={format} />} />
              <Radar dataKey="value" name={weekdayMetric === "count" ? "Movimientos" : "Importe"} stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          ) : (
            <BarChart data={weekdayChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} />
              <YAxis {...chartAxis} tickFormatter={fmtTick(weekdayMode)} width={56} />
              <Tooltip content={<SeriesTooltip format={format} />} cursor={chartBarCursor} />
              <ReferenceLine y={0} stroke={chartColors.grid} />
              <Bar dataKey="value" name={weekdayMetric === "count" ? "Movimientos" : "Importe"} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  };

  const renderStackChart = (expanded: boolean) => {
    if (stackTrend.series.length === 0) {
      return <ChartEmpty message="No hay series suficientes para apilar con esta configuración." height={chartHeight(expanded, 300)} />;
    }
    const common = [
      <CartesianGrid key="grid" {...chartGrid} />,
      <XAxis key="x" dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />,
      <YAxis key="y" {...chartAxis} tickFormatter={fmtTick("currency")} width={56} />,
    ];
    return (
      <>
        <div style={{ height: chartHeight(expanded, 300) }}>
          <ResponsiveContainer width="100%" height="100%">
            {stackView === "area" ? (
              <AreaChart data={stackTrend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {common}
                <Tooltip content={<SeriesTooltip format={fmtValue("currency")} />} cursor={chartCursor} />
                {stackTrend.series.map((s) => (
                  <Area key={s.key} type="monotone" dataKey={s.key} stackId="stack" name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.35} strokeWidth={1.5} />
                ))}
              </AreaChart>
            ) : (
              <BarChart data={stackTrend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {common}
                <Tooltip content={<SeriesTooltip format={fmtValue("currency")} />} cursor={chartBarCursor} />
                {stackTrend.series.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId="stack" name={s.label} fill={s.color} maxBarSize={36} radius={i === stackTrend.series.length - 1 ? [4, 4, 0, 0] : undefined} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        <div className="mt-4"><ChartLegend items={stackTrend.series.map((s) => ({ color: s.color, label: s.label }))} /></div>
      </>
    );
  };

  const renderAccountsChart = (expanded: boolean) => {
    const format = fmtValue(accountMode);
    if (accountChartData.length === 0) {
      return <ChartEmpty message="No hay cuentas con datos para esta vista." height={chartHeight(expanded, 260)} />;
    }
    if (accountView === "donut" && accountMetric !== "net") {
      const slices = accountChartData.filter((a) => a.value > 0);
      const total = slices.reduce((s, a) => s + a.value, 0);
      const size = expanded ? 320 : 200;
      return (
        <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="mx-auto" style={{ width: size, height: size }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="100%" paddingAngle={2} strokeWidth={0}>
                  {slices.map((a) => <Cell key={a.key} fill={a.color} />)}
                </Pie>
                <Tooltip content={<PieTooltip format={format} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="min-w-0 space-y-2">
            {accountChartData.map((a) => (
              <li key={a.key} className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="min-w-0 flex-1 truncate text-foreground">{a.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{total > 0 && a.value > 0 ? formatPct((a.value / total) * 100) : "—"}</span>
                <span className={cn("w-24 text-right font-medium tabular-nums", a.value < 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>{format(a.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <RankedList
        format={format}
        items={accountChartData.map((a) => ({
          key: a.key,
          label: a.label,
          href: transactionsHref({ accountId: a.accountId, from: from || undefined, to: to || undefined }),
          value: a.value,
          color: a.color,
          meta: accountMetric === "count" ? undefined : `${a.transactionCount} mov.`,
        }))}
      />
    );
  };

  const renderEfficiencyChart = (expanded: boolean) => {
    const primaryFormat = fmtValue(efficiencyMode);
    const secondaryIsRate = efficiencyMetric === "count";
    const secondaryKey = secondaryIsRate ? "savingsRate" : "count";
    const secondaryName = secondaryIsRate ? "% de ahorro" : "Movimientos";
    const metricName = efficiencyMetric === "savingsRate" ? "% de ahorro"
      : efficiencyMetric === "avgMovement" ? "Media por movimiento"
        : efficiencyMetric === "netPerMovement" ? "Neto por movimiento"
          : "Movimientos";
    const secondaryFormat = fmtValue(secondaryIsRate ? "percent" : "count");
    return (
      <>
        <div style={{ height: chartHeight(expanded, 260) }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={efficiencyChartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="label" {...chartAxis} interval="preserveStartEnd" minTickGap={16} />
              <YAxis yAxisId="left" {...chartAxis} tickFormatter={fmtTick(efficiencyMode)} width={56} />
              <YAxis yAxisId="right" orientation="right" {...chartAxis} tickFormatter={fmtTick(secondaryIsRate ? "percent" : "count")} width={44} />
              <Tooltip
                content={<SeriesTooltip format={primaryFormat} formatters={{ [secondaryName]: secondaryFormat, [metricName]: primaryFormat }} />}
                cursor={chartBarCursor}
              />
              <ReferenceLine yAxisId="left" y={0} stroke={chartColors.grid} />
              <Bar yAxisId="left" dataKey="displayMetric" name={metricName} fill={flowColors.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line yAxisId="right" type="monotone" dataKey={secondaryKey} name={secondaryName} stroke={flowColors.net} strokeWidth={2} dot={false} activeDot={chartActiveDot} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4">
          <ChartLegend items={[{ color: flowColors.income, label: metricName }, { color: flowColors.net, label: secondaryName, line: true }]} />
        </div>
      </>
    );
  };

  const renderCompareChart = (expanded: boolean) => {
    if (compareData.length === 0) {
      return <ChartEmpty message="No hay datos suficientes para esta comparativa." height={chartHeight(expanded, 260)} />;
    }
    const format = fmtValue(compareMode);
    const data = compareData.map((d) => ({ ...d, incomeDisplay: d.incomeValue, expenseDisplay: -d.expenseValue }));
    const rowHeight = expanded ? 44 : 34;
    return (
      <>
        <div style={{ height: Math.max(data.length * rowHeight + 40, expanded ? 420 : 220) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barGap={-12} barCategoryGap="28%">
              <CartesianGrid {...chartGrid} vertical horizontal={false} />
              <XAxis type="number" {...chartAxis} tickFormatter={(v: number) => fmtTick(compareMode)(Math.abs(v))} />
              <YAxis type="category" dataKey="shortLabel" {...chartAxis} width={expanded ? 150 : 112} />
              <Tooltip content={<SeriesTooltip format={(v) => format(Math.abs(v))} />} cursor={chartBarCursor} />
              <ReferenceLine x={0} stroke={chartColors.axis} strokeOpacity={0.4} />
              <Bar dataKey="incomeDisplay" name="Ingresos" fill={flowColors.income} radius={[0, 4, 4, 0]} maxBarSize={14} />
              <Bar dataKey="expenseDisplay" name="Gastos" fill={flowColors.expense} fillOpacity={0.8} radius={[4, 0, 0, 4]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3"><ChartLegend items={[{ color: flowColors.expense, label: "← Gastos" }, { color: flowColors.income, label: "Ingresos →" }]} /></div>
      </>
    );
  };

  const renderMatrixChart = (expanded: boolean) => (
    <MatrixHeatmap
      months={matrixData.months}
      rows={matrixData.rows}
      color={matrixMetric === "expense" ? flowColors.expense : flowColors.income}
      expanded={expanded}
    />
  );

  // ─── Paneles ──────────────────────────────────────────────────
  const panels: Record<ChartPanelKey, PanelConfig> = {
    trend: {
      title: "Pulso mensual",
      description: [
        "Ingresos, gastos, flujo neto, volumen y ahorro de cada mes.",
        summary.topIncomeMonth && `Pico de ingresos: ${formatMonthLabel(summary.topIncomeMonth.month)} (${formatCurrency(summary.topIncomeMonth.total)}).`,
        summary.topExpenseMonth && `Pico de gasto: ${formatMonthLabel(summary.topExpenseMonth.month)} (${formatCurrency(summary.topExpenseMonth.total)}).`,
      ].filter(Boolean).join(" "),
      controls: (
        <>
          <Segmented aria-label="Métrica" value={trendMetric} onChange={setTrendMetric} options={[
            { value: "all", label: "Todo" },
            { value: "income", label: "Ingresos" },
            { value: "expenses", label: "Gastos" },
            { value: "net", label: "Neto" },
            { value: "count", label: "Mov." },
            { value: "savingsRate", label: "% ahorro" },
          ]} />
          <Segmented aria-label="Tipo de gráfico" value={trendView} onChange={setTrendView} options={[
            { value: "bars", label: "Barras" },
            { value: "area", label: "Área" },
            { value: "line", label: "Líneas" },
          ]} />
        </>
      ),
      render: renderTrendChart,
    },
    cumulative: {
      title: "Acumulado",
      description: "La pendiente real del periodo: cuánto sumas mes a mes.",
      controls: (
        <>
          <Segmented aria-label="Métrica acumulada" value={cumulativeMetric} onChange={setCumulativeMetric} options={[
            { value: "net", label: "Neto" },
            { value: "income", label: "Ingresos" },
            { value: "expenses", label: "Gastos" },
            { value: "count", label: "Mov." },
          ]} />
          <Segmented aria-label="Tipo de gráfico" value={cumulativeView} onChange={setCumulativeView} options={[
            { value: "area", label: "Área" },
            { value: "line", label: "Línea" },
          ]} />
        </>
      ),
      render: renderCumulativeChart,
    },
    efficiency: {
      title: "Eficiencia mensual",
      description: "Ahorro, importe medio por movimiento y densidad de actividad.",
      controls: (
        <Segmented aria-label="Métrica de eficiencia" value={efficiencyMetric} onChange={setEfficiencyMetric} options={[
          { value: "savingsRate", label: "% ahorro" },
          { value: "avgMovement", label: "Media/mov." },
          { value: "netPerMovement", label: "Neto/mov." },
          { value: "count", label: "Movimientos" },
        ]} />
      ),
      render: renderEfficiencyChart,
    },
    distribution: {
      title: "Distribución",
      description: "Qué categorías o grupos concentran el dinero o los movimientos.",
      controls: (
        <>
          <Segmented aria-label="Tipo de flujo" value={distributionMetric} onChange={setDistributionMetric} options={FLOW_OPTIONS} />
          <Segmented aria-label="Agrupación" value={distributionScope} onChange={setDistributionScope} options={SCOPE_OPTIONS} />
          <Segmented aria-label="Valor" value={distributionValue} onChange={setDistributionValue} options={RANK_VALUE_OPTIONS} />
          <Segmented aria-label="Tipo de gráfico" value={distributionView} onChange={setDistributionView} options={[
            { value: "donut", label: "Donut" },
            { value: "bars", label: "Ranking" },
          ]} />
          <LimitSelect label="Número de series" value={distributionLimit} onChange={setDistributionLimit} options={[5, 8, 12]} />
        </>
      ),
      render: renderDistributionChart,
    },
    payees: {
      title: payeeMetric === "expense" ? "Beneficiarios principales" : "Orígenes principales",
      description: `Por ${RANK_VALUE_LABEL[payeeValue].toLowerCase()}: a quién pagas o de quién cobras más.`,
      controls: (
        <>
          <Segmented aria-label="Tipo de flujo" value={payeeMetric} onChange={setPayeeMetric} options={FLOW_OPTIONS} />
          <Segmented aria-label="Valor" value={payeeValue} onChange={setPayeeValue} options={RANK_VALUE_OPTIONS} />
          <LimitSelect label="Número de beneficiarios" value={payeeLimit} onChange={setPayeeLimit} options={[5, 8, 12]} />
        </>
      ),
      render: renderPayeesChart,
    },
    compare: {
      title: "Ingresos frente a gastos",
      description: "Ambas direcciones del flujo por grupo o categoría, en una sola lectura.",
      controls: (
        <>
          <Segmented aria-label="Agrupación" value={compareScope} onChange={setCompareScope} options={[
            { value: "group", label: "Grupo" },
            { value: "category", label: "Categoría" },
          ]} />
          <Segmented aria-label="Valor" value={compareValue} onChange={setCompareValue} options={RANK_VALUE_OPTIONS} />
          <LimitSelect label="Número de filas" value={compareLimit} onChange={setCompareLimit} options={[4, 6, 8]} />
        </>
      ),
      render: renderCompareChart,
    },
    weekday: {
      title: "Ritmo semanal",
      description: "En qué días de la semana se concentra tu actividad.",
      controls: (
        <>
          <Segmented aria-label="Métrica" value={weekdayMetric} onChange={setWeekdayMetric} options={[
            { value: "expense", label: "Gasto" },
            { value: "income", label: "Ingreso" },
            { value: "net", label: "Neto" },
            { value: "count", label: "Mov." },
          ]} />
          <Segmented
            aria-label="Tipo de gráfico"
            value={weekdayView}
            onChange={(v) => { if (!(weekdayMetric === "net" && v === "radar")) setWeekdayView(v); }}
            options={[
              { value: "radar", label: "Radar" },
              { value: "bars", label: "Barras" },
            ]}
          />
        </>
      ),
      render: renderWeekdayChart,
    },
    stack: {
      title: stackGrouping === "category" ? "Tendencia por categoría" : "Tendencia por grupo",
      description: "El peso de cada serie mes a mes, apilado.",
      controls: (
        <>
          <Segmented aria-label="Agrupación" value={stackGrouping} onChange={setStackGrouping} options={SCOPE_OPTIONS} />
          <Segmented aria-label="Tipo de flujo" value={stackMetric} onChange={setStackMetric} options={FLOW_OPTIONS} />
          <Segmented aria-label="Tipo de gráfico" value={stackView} onChange={setStackView} options={[
            { value: "bars", label: "Barras" },
            { value: "area", label: "Área" },
          ]} />
          <LimitSelect label="Número de series apiladas" value={stackLimit} onChange={setStackLimit} options={[3, 5, 8]} />
        </>
      ),
      render: renderStackChart,
    },
    matrix: {
      title: "Matriz temporal",
      description: "Qué series empujan cada mes y dónde aparecen los picos.",
      controls: (
        <>
          <Segmented aria-label="Agrupación" value={matrixScope} onChange={setMatrixScope} options={SCOPE_OPTIONS} />
          <Segmented aria-label="Tipo de flujo" value={matrixMetric} onChange={setMatrixMetric} options={FLOW_OPTIONS} />
          <LimitSelect label="Número de series" value={matrixLimit} onChange={setMatrixLimit} options={[4, 6, 8]} />
        </>
      ),
      render: renderMatrixChart,
    },
    accounts: {
      title: "Peso por cuenta",
      description: "Tus cuentas por saldo, ingresos, gastos, neto o volumen.",
      controls: (
        <>
          <Segmented aria-label="Métrica" value={accountMetric} onChange={setAccountMetric} options={[
            { value: "balance", label: "Saldo" },
            { value: "income", label: "Ingresos" },
            { value: "expenses", label: "Gastos" },
            { value: "net", label: "Neto" },
            { value: "count", label: "Mov." },
          ]} />
          <Segmented
            aria-label="Tipo de gráfico"
            value={accountView}
            onChange={(v) => { if (!(accountMetric === "net" && v === "donut")) setAccountView(v); }}
            options={[
              { value: "bars", label: "Ranking" },
              { value: "donut", label: "Donut" },
            ]}
          />
          <LimitSelect label="Número de cuentas" value={accountLimit} onChange={setAccountLimit} options={[4, 6, 8]} />
        </>
      ),
      render: renderAccountsChart,
    },

    // ─── Gráficos nuevos ─────────────────────────────────────────
    pace: {
      title: "Ritmo de gasto",
      description: "Cuánto llevas gastado este mes frente al pasado y a tu media, y a dónde llegarías al ritmo actual.",
      render: (expanded) => <PaceChart accountId={accountId} groupId={groupId} categoryId={categoryId} expanded={expanded} />,
    },
    treemap: {
      title: treemapMetric === "expense" ? "Mapa de gasto" : "Mapa de ingresos",
      description: "Cada bloque es una categoría, agrupadas por grupo: cuanto más grande, más dinero.",
      controls: <Segmented aria-label="Tipo de flujo" value={treemapMetric} onChange={setTreemapMetric} options={FLOW_OPTIONS} />,
      render: (expanded) => <TreemapChart categories={analytics?.categories ?? []} metric={treemapMetric} expanded={expanded} />,
    },
    waterfall: {
      title: "De ingresos a ahorro",
      description: "Lo que entra, lo que se lleva cada grupo de gasto y lo que te queda (o te falta).",
      controls: <LimitSelect label="Número de grupos" value={waterfallLimit} onChange={setWaterfallLimit} options={[4, 6, 8, 10]} />,
      render: (expanded) => (
        <WaterfallChart
          income={summary.incomeTotal}
          groups={(analytics?.groups ?? []).filter((g) => g.type === "expense").map((g) => ({ name: g.groupName, total: g.total }))}
          limit={waterfallLimit}
          expanded={expanded}
        />
      ),
    },
    sankey: {
      title: "Flujo del dinero",
      description: "De dónde viene (ingresos) y a dónde va (grupos de gasto y ahorro). Si gastas más de lo que ingresas, lo verás como «desde ahorros previos».",
      controls: <LimitSelect label="Número de grupos" value={sankeyLimit} onChange={setSankeyLimit} options={[4, 6, 8, 10]} />,
      render: (expanded) => (
        <SankeyChart
          income={summary.incomeTotal}
          groups={(analytics?.groups ?? []).filter((g) => g.type === "expense").map((g) => ({ name: g.groupName, total: g.total }))}
          limit={sankeyLimit}
          expanded={expanded}
        />
      ),
    },
    calendar: {
      title: "Calendario de calor",
      description: "Cada cuadrado es un día: cuanto más intenso, más dinero. Pulsa uno para ver sus movimientos.",
      controls: <Segmented aria-label="Tipo de flujo" value={calendarMetric} onChange={setCalendarMetric} options={FLOW_OPTIONS} />,
      render: (expanded) => (
        <CalendarHeatmap accountId={accountId} groupId={groupId} categoryId={categoryId} from={from} to={to} metric={calendarMetric} expanded={expanded} />
      ),
    },
    multiples: {
      title: "Categorías una a una",
      description: "La evolución mensual de cada categoría en su propio minigráfico. Pulsa una para ver sus movimientos.",
      controls: (
        <>
          <Segmented aria-label="Tipo de flujo" value={multiplesMetric} onChange={setMultiplesMetric} options={FLOW_OPTIONS} />
          <LimitSelect label="Número de categorías" value={multiplesLimit} onChange={setMultiplesLimit} options={[4, 8, 12, 16]} />
        </>
      ),
      render: (expanded) => (
        <SmallMultiples
          monthlyCategories={analytics?.monthlyCategories ?? []}
          months={monthlyChartData.map((m) => m.month)}
          metric={multiplesMetric}
          limit={multiplesLimit}
          accountId={accountId}
          expanded={expanded}
        />
      ),
    },
    yoy: {
      title: "Año contra año",
      description: "Cada año como una línea sobre los mismos 12 meses (los últimos tres años, sin importar el periodo de arriba).",
      controls: (
        <Segmented
          aria-label="Métrica"
          value={yoyMetric}
          onChange={setYoyMetric}
          options={[{ value: "expenses", label: "Gastos" }, { value: "income", label: "Ingresos" }, { value: "savings", label: "Ahorro" }]}
        />
      ),
      render: (expanded) => <YearOverYearChart accountId={accountId} groupId={groupId} categoryId={categoryId} metric={yoyMetric} expanded={expanded} />,
    },
    budget: {
      title: "Presupuesto frente a gasto",
      description: "Lo presupuestado y lo gastado de cada categoría en el mes que elijas.",
      controls: <LimitSelect label="Número de categorías" value={budgetLimit} onChange={setBudgetLimit} options={[6, 8, 12, 16]} />,
      render: (expanded) => <BudgetVsActualChart limit={budgetLimit} expanded={expanded} />,
    },
    amounts: {
      title: "Tamaño de los movimientos",
      description: "¿Muchos movimientos pequeños o pocos grandes? Cuántos hay (o cuánto dinero suman) en cada tramo de importe.",
      controls: (
        <>
          <Segmented aria-label="Tipo de flujo" value={amountsMetric} onChange={setAmountsMetric} options={FLOW_OPTIONS} />
          <Segmented
            aria-label="Valor"
            value={amountsView}
            onChange={setAmountsView}
            options={[{ value: "count", label: "Movimientos" }, { value: "total", label: "Importe" }]}
          />
        </>
      ),
      render: (expanded) => (
        <AmountsChart accountId={accountId} groupId={groupId} categoryId={categoryId} from={from} to={to} metric={amountsMetric} view={amountsView} expanded={expanded} />
      ),
    },
  };

  const panel = (key: ChartPanelKey, className?: string) => (
    <AnalyticsPanel panel={panels[key]} onExpand={() => setExpandedPanel(key)} className={className} />
  );

  // ─── Cabecera y filtros ───────────────────────────────────────
  const scopeLabel = [
    selectedAccount?.name ?? "Todas las cuentas",
    selectedGroup?.name,
    selectedCategory?.name,
  ].filter(Boolean).join(" · ");

  const categoryOptionGroups = (groupId ? categoryGroups.filter((g) => g.id === groupId) : categoryGroups).map((g) => ({
    label: g.name,
    options: g.categories.map((c) => ({ value: String(c.id), label: c.name })),
  }));

  const header = (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange className="size-3.5" />
          {isFetching ? "Actualizando…" : `${rangeLabel(from, to)} · ${summary.visibleMonths} meses · ${summary.transactionCount} movimientos`}
        </span>
      }
      title="Analítica"
      accent="financiera."
      description="Explora ingresos y gastos por periodo, cuenta y categoría. Cada panel se puede ampliar."
      actions={
        <>
          <Segmented aria-label="Periodo" value={periodPreset} onChange={applyPreset} options={PRESET_OPTIONS} />
          <AnalyticsViewsMenu
            views={views}
            defaultViewId={defaultViewId}
            activeViewId={activeViewId}
            onApply={applyView}
            onSave={saveCurrentView}
            onDelete={deleteView}
            onSetDefault={setDefaultViewId}
          />
          <Button variant="outline" size="sm" className="gap-1.5 bg-card" onClick={() => setCustomizeOpen(true)}>
            <SlidersHorizontal className="size-3.5" aria-hidden="true" /> Personalizar
          </Button>
          <Button variant="outline" size="icon-sm" className="bg-card" onClick={() => refetch()} disabled={isFetching} aria-label="Actualizar" title="Actualizar">
            <RefreshCcw className={cn("size-3.5", isFetching && "animate-spin")} />
          </Button>
        </>
      }
    >
      <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
      <FilterSelect
        label="Grupo"
        allLabel="Todos los grupos"
        value={groupId ? String(groupId) : ""}
        onChange={(v) => {
          const next = v ? Number(v) : undefined;
          setGroupId(next);
          if (next && !flatCategories.some((c) => c.id === categoryId && c.groupId === next)) setCategoryId(undefined);
        }}
        options={categoryGroups.map((g) => ({ value: String(g.id), label: g.name }))}
      />
      <FilterSelect
        label="Categoría"
        allLabel="Todas las categorías"
        value={categoryId ? String(categoryId) : ""}
        onChange={(v) => setCategoryId(v ? Number(v) : undefined)}
        groups={categoryOptionGroups}
      />
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          aria-label="Desde"
          value={from}
          onChange={(e) => { setPeriodPreset("custom"); setFrom(e.target.value); }}
          className="h-7 w-[8.75rem] bg-card px-2 text-xs"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="date"
          aria-label="Hasta"
          value={to}
          onChange={(e) => { setPeriodPreset("custom"); setTo(e.target.value); }}
          className="h-7 w-[8.75rem] bg-card px-2 text-xs"
        />
      </div>
      {hasFiltersApplied && (
        <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
          <X className="size-3.5" /> Limpiar filtros
        </Button>
      )}
    </PageHeader>
  );

  const insightsCard = (
      <SectionCard title="Lecturas rápidas" description="Se recalculan con los filtros y controles de cada panel">
        <div className="grid gap-3 sm:grid-cols-2">
          <Insight
            label="Serie dominante"
            value={distributionData[0]?.label ?? "—"}
            hint={distributionData[0] ? `${fmtValue(distributionMode)(distributionData[0].value)} · ${formatPct(distributionData[0].share)}` : "Sin datos en Distribución"}
          />
          <Insight
            label="Día con más actividad"
            value={topWeekday && topWeekday.value !== 0 ? topWeekday.label : "—"}
            hint={topWeekday && topWeekday.value !== 0 ? fmtValue(weekdayMode)(Math.abs(topWeekday.value)) : "Sin patrón semanal"}
          />
          <Insight
            label="Series apiladas"
            value={String(stackTrend.series.length)}
            hint={`${stackGrouping === "category" ? "Categorías" : "Grupos"} en la tendencia`}
          />
          <Insight
            label="Cuenta con más peso"
            value={accountChartData[0]?.label ?? "—"}
            hint={accountChartData[0] ? fmtValue(accountMode)(accountChartData[0].value) : "Sin datos de cuenta"}
          />
        </div>
        <a href="/app/transactions" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-5 w-full")}>
          Ver movimientos
        </a>
      </SectionCard>
  );

  return (
    <div>
      {header}

      <StatGrid>
        <StatCard
          label="Saldo actual"
          value={formatCurrency(summary.totalBalance)}
          icon={Wallet}
          hint={scopeLabel}
          emphasis
        />
        <StatCard
          label="Ingresos"
          value={formatCurrency(summary.incomeTotal)}
          icon={ArrowUpRight}
          hint={`Media ${formatCurrency(summary.monthlyAverageIncome)}/mes`}
          sparkline={monthlyChartData.length > 2 ? monthlyChartData.map((m) => m.income) : undefined}
          sparklineColor={flowColors.income}
        />
        <StatCard
          label="Gastos"
          value={formatCurrency(summary.expenseTotal)}
          icon={ArrowDownRight}
          hint={`Media ${formatCurrency(summary.monthlyAverageExpenses)}/mes`}
          sparkline={monthlyChartData.length > 2 ? monthlyChartData.map((m) => m.expenses) : undefined}
          sparklineColor={flowColors.expense}
        />
        <StatCard
          label="Flujo neto"
          value={formatCurrency(summary.netTotal)}
          icon={Scale}
          delta={
            summary.incomeTotal > 0
              ? {
                value: formatPct(summary.savingsRate),
                trend: summary.savingsRate > 0 ? "up" : summary.savingsRate < 0 ? "down" : "flat",
                label: "de ahorro",
              }
              : undefined
          }
          sparkline={cumulativeChartData.length > 2 ? cumulativeChartData.map((m) => m.cumulativeNet) : undefined}
          sparklineColor={flowColors.net}
        />
      </StatGrid>

      {!hasTransactions ? (
        <EmptyState
          className="mt-6"
          icon={CalendarRange}
          title="Sin movimientos para esta selección"
          description="Ajusta el periodo o los filtros, o revisa los movimientos pendientes si esperabas ver actividad."
        >
          {hasFiltersApplied && <Button variant="outline" onClick={resetFilters}>Ver últimos 12 meses</Button>}
        </EmptyState>
      ) : (
        <>
          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            {layout.filter((entry) => entry.visible).map((entry) => (
              <div key={entry.key} className={cn("min-w-0", entry.span === "full" && "xl:col-span-2")}>
                {entry.key === "insights" ? insightsCard : panel(entry.key)}
              </div>
            ))}
          </div>
          {layout.every((entry) => !entry.visible) && (
            <EmptyState className="mt-8" icon={SlidersHorizontal} title="Has ocultado todos los gráficos" description="Elige cuáles quieres ver desde «Personalizar».">
              <Button onClick={() => setCustomizeOpen(true)}>Personalizar</Button>
            </EmptyState>
          )}
        </>
      )}

      <ExpandedPanelDialog panel={expandedPanel ? panels[expandedPanel] : null} onClose={() => setExpandedPanel(null)} />
      <AnalyticsCustomizeSheet
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        layout={layout}
        onChange={(next: LayoutEntry[]) => setStoredLayout(next)}
        onReset={() => layoutPref.reset()}
      />
    </div>
  );
}

export default function FinanceAnalyticsPage() {
  return (
    <Providers>
      <FinanceAnalyticsView />
    </Providers>
  );
}
