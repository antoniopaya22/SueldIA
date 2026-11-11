// Utilidades de cálculo de Analítica (sin React), compartidas por la página y
// por useDerivedAnalytics.

export type RankValue = "total" | "count" | "average";

/** Valor con el que se ordena un ranking: importe, nº de movimientos o importe medio. */
export function rankValue(total: number, count: number, mode: RankValue): number {
  if (mode === "count") return count;
  if (mode === "average") return total / Math.max(count, 1);
  return total;
}

export interface CompareDatum {
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

/** Acumulados mes a mes (ingresos, gastos, neto y movimientos). */
export function accumulate<T extends { income: number; expenses: number; net: number; transactionCount: number }>(items: T[]) {
  let income = 0;
  let expenses = 0;
  let net = 0;
  let count = 0;
  return items.map((item) => {
    income += item.income;
    expenses += item.expenses;
    net += item.net;
    count += item.transactionCount;
    return { ...item, cumulativeIncome: income, cumulativeExpenses: expenses, cumulativeNet: net, cumulativeCount: count };
  });
}
