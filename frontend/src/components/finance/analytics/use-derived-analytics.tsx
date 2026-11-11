import { useMemo } from "react";
import { transactionsHref } from "../../../lib/transaction-filters";
import { formatMonthLabel } from "../../../lib/format";
import { adaptiveColor, paletteColor, shortenLabel } from "../finance-ui";
import { alignPrevious, changeByKey, isPartialMonth } from "../../../lib/analytics-compare";
import type { PanelSettings } from "../../../lib/analytics-settings";
import type { FinanceAnalyticsCategoryItem, FinanceAnalyticsData, FinanceAnalyticsGroupItem } from "../../../lib/api";
import { accumulate, rankValue, type CompareDatum } from "./model";

// Datos de cada gráfico de Analítica, calculados a partir de la respuesta de
// la API (y del periodo anterior, si se compara). Separado de la página para
// que esta solo se ocupe de filtros, paneles y diseño.
export interface DerivedAnalyticsInput {
  analytics: FinanceAnalyticsData | undefined;
  /** Datos del periodo anterior, solo si se está comparando. */
  prev: FinanceAnalyticsData | undefined;
  from: string;
  to: string;
  prevRange: { from: string; to: string } | null;
  compareActive: boolean;
  accountId: number | undefined;
  settings: PanelSettings;
}

export function useDerivedAnalytics(input: DerivedAnalyticsInput) {
  const { analytics, prev, from, to, prevRange, compareActive, accountId, settings } = input;
  const {
    payeeMetric,
    distributionScope,
    distributionMetric,
    accountMetric,
    weekdayMetric,
    stackGrouping,
    payeeValue,
    matrixScope,
    efficiencyMetric,
    distributionValue,
    cumulativeMetric,
    trendMetric,
    stackMetric,
    matrixMetric,
    compareValue,
    compareScope,
    stackLimit,
    payeeLimit,
    matrixLimit,
    distributionLimit,
    compareLimit,
    accountLimit,
  } = settings;
  const monthlyChartData = useMemo(() => (analytics?.monthly ?? []).map((item) => ({
    ...item,
    label: formatMonthLabel(item.month),
    count: item.transactionCount,
    savingsRate: item.income > 0 ? (item.net / item.income) * 100 : 0,
    avgMovement: item.transactionCount > 0 ? (item.income + item.expenses) / item.transactionCount : 0,
    netPerMovement: item.transactionCount > 0 ? item.net / item.transactionCount : 0,
  })), [analytics]);

  const prevMonthly = useMemo(() => (prev?.monthly ?? []).map((item) => ({
    ...item,
    label: formatMonthLabel(item.month),
    count: item.transactionCount,
    savingsRate: item.income > 0 ? (item.net / item.income) * 100 : 0,
  })), [prev]);

  const cumulativeChartData = useMemo(() => accumulate(monthlyChartData), [monthlyChartData]);
  const prevCumulative = useMemo(() => accumulate(prevMonthly), [prevMonthly]);

  // Series con el periodo anterior alineado por posición (mes 1 con mes 1…). Solo con una métrica concreta: con "Todo" serían seis líneas.
  const trendData = useMemo(
    () => (compareActive && trendMetric !== "all"
      // Los meses cortados por el borde del periodo anterior se dejan sin punto: compararlos con un mes entero dibujaría una caída que no existe.
      ? alignPrevious(monthlyChartData, prevMonthly, (m) => (prevRange && isPartialMonth(m.month, prevRange) ? null : m[trendMetric]))
      : monthlyChartData),
    [compareActive, monthlyChartData, prevMonthly, prevRange, trendMetric],
  );
  const cumulativeData = useMemo(() => {
    if (!compareActive) return cumulativeChartData;
    const key = cumulativeMetric === "income" ? "cumulativeIncome"
      : cumulativeMetric === "expenses" ? "cumulativeExpenses"
        : cumulativeMetric === "count" ? "cumulativeCount"
          : "cumulativeNet";
    return alignPrevious(cumulativeChartData, prevCumulative, (m) => m[key]);
  }, [compareActive, cumulativeChartData, cumulativeMetric, prevCumulative]);

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

  // Valor de cada categoría/grupo y beneficiario en el periodo anterior, con el mismo valor (importe, nº, media) elegido en el panel.
  const prevDistribution = useMemo(() => {
    const source: Array<FinanceAnalyticsCategoryItem | FinanceAnalyticsGroupItem> =
      distributionScope === "category" ? prev?.categories ?? [] : prev?.groups ?? [];
    return new Map(source.filter((i) => i.type === distributionMetric).map((i) => [i.bucketKey, rankValue(i.total, i.count, distributionValue)]));
  }, [distributionMetric, distributionScope, distributionValue, prev]);
  const prevPayees = useMemo(
    () => new Map((prev?.payees ?? []).filter((i) => i.type === payeeMetric).map((i) => [i.bucketKey, rankValue(i.total, i.count, payeeValue)])),
    [payeeMetric, payeeValue, prev],
  );
  const distributionChange = useMemo(
    () => (prev ? changeByKey(distributionData, prevDistribution) : null),
    [distributionData, prev, prevDistribution],
  );
  const payeeChange = useMemo(() => (prev ? changeByKey(payeeData, prevPayees) : null), [payeeData, prev, prevPayees]);

  const topWeekday = useMemo(
    () => [...weekdayChartData].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0],
    [weekdayChartData],
  );

  return { monthlyChartData, prevMonthly, cumulativeChartData, prevCumulative, trendData, cumulativeData, distributionData, payeeData, stackTrend, weekdayChartData, accountChartData, efficiencyChartData, compareData, matrixData, prevDistribution, prevPayees, distributionChange, payeeChange, topWeekday };
}
