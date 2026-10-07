import { db } from "../db/index.js";
import { accounts, transactions, categories, categoryGroups } from "../db/schema.js";
import { eq, and, sql, gte, lte, asc } from "drizzle-orm";
import { effectiveTransaction } from "./transaction-filters.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";

type FinanceFlowType = "income" | "expense";

/* ───────── Types ────────────────────────────────────────────── */

export interface FinanceFilters {
  userId: number;
  from?: string;
  to?: string;
  accountId?: number;
  groupId?: number;
  categoryId?: number;
}

export interface AccountWithBalance {
  id: number;
  name: string;
  type: string;
  currency: string;
  initialBalance: number;
  color: string;
  icon: string | null;
  archived: boolean;
  /** Saldo liquidado: saldo inicial + movimientos liquidados (lo que ya refleja el banco). */
  balance: number;
  /** Suma con signo de los movimientos sin liquidar con fecha de hoy o anterior. */
  unclearedBalance: number;
  /** Cuántos movimientos sin liquidar hay (hasta hoy). */
  unclearedCount: number;
  /** Saldo de trabajo: liquidado + sin liquidar. Lo programado a futuro no cuenta todavía. */
  workingBalance: number;
  createdAt: string;
}

export interface MonthlyTrend {
  month: string;
  income: number;
  expenses: number;
  savings: number;
}

export interface CategoryBreakdownItem {
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  total: number;
  percentage: number;
}

export interface TopPayee {
  payee: string;
  total: number;
  count: number;
}

export interface FinanceSummary {
  totalBalance: number;
  monthExpenses: number;
  monthIncome: number;
  monthSavings: number;
}

export interface FinanceAnalyticsSummary {
  totalBalance: number;
  incomeTotal: number;
  expenseTotal: number;
  netTotal: number;
  monthlyAverageIncome: number;
  monthlyAverageExpenses: number;
  savingsRate: number;
  visibleMonths: number;
  transactionCount: number;
  topIncomeMonth: { month: string; total: number } | null;
  topExpenseMonth: { month: string; total: number } | null;
}

export interface FinanceAnalyticsMonth {
  month: string;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsCategoryItem {
  bucketKey: string;
  categoryId: number | null;
  categoryName: string;
  groupId: number | null;
  groupName: string;
  type: FinanceFlowType;
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsGroupItem {
  bucketKey: string;
  groupId: number | null;
  groupName: string;
  type: FinanceFlowType;
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsPayeeItem {
  bucketKey: string;
  payee: string;
  type: FinanceFlowType;
  total: number;
  count: number;
  percentage: number;
}

export interface FinanceAnalyticsAccountItem {
  accountId: number;
  accountName: string;
  color: string;
  balance: number;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsWeekdayItem {
  weekdayIndex: number;
  weekdayLabel: string;
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
}

export interface FinanceAnalyticsMonthBucket {
  month: string;
  bucketKey: string;
  bucketId: number | null;
  label: string;
  parentLabel: string | null;
  type: FinanceFlowType;
  total: number;
}

export interface FinanceAnalyticsData {
  summary: FinanceAnalyticsSummary;
  monthly: FinanceAnalyticsMonth[];
  categories: FinanceAnalyticsCategoryItem[];
  groups: FinanceAnalyticsGroupItem[];
  payees: FinanceAnalyticsPayeeItem[];
  accounts: FinanceAnalyticsAccountItem[];
  weekdays: FinanceAnalyticsWeekdayItem[];
  monthlyCategories: FinanceAnalyticsMonthBucket[];
  monthlyGroups: FinanceAnalyticsMonthBucket[];
}

interface FinanceAnalyticsSourceRow {
  id: number;
  accountId: number;
  accountName: string;
  accountColor: string;
  categoryId: number | null;
  categoryName: string;
  groupId: number | null;
  groupName: string;
  type: FinanceFlowType;
  amount: number;
  date: string;
  payee: string;
}

/* ───────── Helpers ──────────────────────────────────────────── */

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function getMonthKey(date: string): string {
  return date.slice(0, 7);
}

function buildMonthRange(filters: FinanceFilters, rows: FinanceAnalyticsSourceRow[]): string[] {
  const nowMonth = getMonthKey(new Date().toISOString().slice(0, 10));
  const startMonth = filters.from?.slice(0, 7) ?? rows[0]?.date.slice(0, 7) ?? nowMonth;
  const endMonth = filters.to?.slice(0, 7) ?? rows[rows.length - 1]?.date.slice(0, 7) ?? startMonth;

  const result: string[] = [];
  const cursor = new Date(`${startMonth}-01T00:00:00`);
  const end = new Date(`${endMonth}-01T00:00:00`);

  while (cursor <= end) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

function getWeekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00`).getDay();
  return (day + 6) % 7;
}

function finalizeBreakdownByType<T extends { type: FinanceFlowType; total: number }>(
  items: T[],
): Array<T & { percentage: number }> {
  const totals = items.reduce(
    (acc, item) => {
      acc[item.type] += item.total;
      return acc;
    },
    { income: 0, expense: 0 },
  );

  return items
    .map((item) => ({
      ...item,
      total: roundValue(item.total),
      percentage: totals[item.type] > 0 ? roundValue((item.total / totals[item.type]) * 100) : 0,
    }))
    .sort((left, right) => right.total - left.total);
}

async function listFilteredFinanceRows(filters: FinanceFilters): Promise<FinanceAnalyticsSourceRow[]> {
  const conditions = [
    eq(transactions.userId, filters.userId),
    effectiveTransaction(),
    sql`${transactions.type} != 'transfer'`,
  ];

  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));
  if (filters.accountId) conditions.push(eq(transactions.accountId, filters.accountId));
  if (filters.groupId) conditions.push(eq(categories.groupId, filters.groupId));
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryId: transactions.categoryId,
      categoryName: sql<string>`coalesce(${categories.name}, 'Sin categoría')`,
      groupId: categories.groupId,
      groupName: sql<string>`coalesce(${categoryGroups.name}, 'Sin grupo')`,
      type: transactions.type,
      amount: transactions.amount,
      date: transactions.date,
      payee: sql<string>`coalesce(nullif(${transactions.payee}, ''), 'Sin beneficiario')`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    .orderBy(asc(transactions.date), asc(transactions.id));

  return rows.filter(
    (row): row is FinanceAnalyticsSourceRow => row.type === "income" || row.type === "expense",
  );
}

/* ───────── Account balance ──────────────────────────────────── */

/**
 * Efecto de un movimiento en el saldo de SU cuenta: + ingreso, − gasto y, en un
 * traspaso, + la pata de entrada (la de id más bajo del par) y − la de salida.
 */
export const signedAmountSql = sql`
  case
    when ${transactions.type} = 'income' then ${transactions.amount}
    when ${transactions.type} = 'expense' then -${transactions.amount}
    when ${transactions.type} = 'transfer' and ${transactions.transferId} is not null and ${transactions.transferId} < ${transactions.id}
      then ${transactions.amount}
    when ${transactions.type} = 'transfer' then -${transactions.amount}
    else 0
  end`;

export async function getAccountsWithBalance(userId: number): Promise<AccountWithBalance[]> {
  const userAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(accounts.name);

  // Una sola consulta agregada en vez de una por cuenta (N+1): Postgres
  // suma el importe con signo (misma regla que antes para transferencias —
  // la pata con el id más bajo del par es la entrada) agrupado por cuenta.
  // El saldo liquidado sigue el criterio de effectiveTransaction(); aparte se
  // suma lo sin liquidar hasta hoy (lo programado a futuro, p. ej. las
  // recurrentes ya generadas, aún no ha ocurrido y no entra en el saldo de trabajo).
  const today = getTodayIsoDate();
  const sums = await db
    .select({
      accountId: transactions.accountId,
      // sum() sobre doublePrecision devuelve double precision (número), no
      // numeric (que sí llegaría como string) — ver la nota de schema.ts.
      cleared: sql<number>`coalesce(sum(${signedAmountSql}) filter (where ${effectiveTransaction()}), 0)`.as("cleared"),
      uncleared: sql<number>`coalesce(sum(${signedAmountSql}) filter (where not ${transactions.cleared} and ${transactions.date} <= ${today}), 0)`.as("uncleared"),
      unclearedCount: sql<number>`count(*) filter (where not ${transactions.cleared} and ${transactions.date} <= ${today})::int`.as("uncleared_count"),
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.accountId);

  const sumMap = new Map(sums.map((row) => [row.accountId, row]));

  return userAccounts.map((acc) => ({
    id: acc.id,
    name: acc.name,
    type: acc.type,
    currency: acc.currency,
    initialBalance: acc.initialBalance,
    color: acc.color,
    icon: acc.icon,
    archived: acc.archived ?? false,
    balance: roundValue(acc.initialBalance + Number(sumMap.get(acc.id)?.cleared ?? 0)),
    unclearedBalance: roundValue(Number(sumMap.get(acc.id)?.uncleared ?? 0)),
    unclearedCount: Number(sumMap.get(acc.id)?.unclearedCount ?? 0),
    workingBalance: roundValue(acc.initialBalance + Number(sumMap.get(acc.id)?.cleared ?? 0) + Number(sumMap.get(acc.id)?.uncleared ?? 0)),
    createdAt: acc.createdAt.toISOString(),
  }));
}

/* ───────── Monthly trends ───────────────────────────────────── */

export async function getMonthlyTrends(filters: FinanceFilters): Promise<MonthlyTrend[]> {
  const rows = await listFilteredFinanceRows(filters);
  const monthMap = new Map<string, { income: number; expenses: number }>();

  for (const month of buildMonthRange(filters, rows)) {
    monthMap.set(month, { income: 0, expenses: 0 });
  }

  for (const row of rows) {
    const entry = monthMap.get(getMonthKey(row.date));
    if (!entry) continue;
    if (row.type === "income") {
      entry.income += row.amount;
    } else {
      entry.expenses += row.amount;
    }
  }

  return Array.from(monthMap.entries()).map(([month, data]) => ({
    month,
    income: roundValue(data.income),
    expenses: roundValue(data.expenses),
    savings: roundValue(data.income - data.expenses),
  }));
}

/* ───────── Category breakdown ───────────────────────────────── */

export async function getCategoryBreakdown(filters: FinanceFilters): Promise<CategoryBreakdownItem[]> {
  const rows = await listFilteredFinanceRows(filters);
  const expenseRows = rows.filter((row) => row.type === "expense");
  const categoryMap = new Map<string, { categoryId: number | null; categoryName: string; groupName: string; total: number }>();

  for (const row of expenseRows) {
    const key = `expense:${row.categoryId ?? "none"}`;
    const existing = categoryMap.get(key) ?? {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      groupName: row.groupName,
      total: 0,
    };
    existing.total += row.amount;
    categoryMap.set(key, existing);
  }

  const items = Array.from(categoryMap.values());
  const grandTotal = items.reduce((sum, item) => sum + item.total, 0);

  return items
    .map((item) => ({
      ...item,
      total: roundValue(item.total),
      percentage: grandTotal > 0 ? roundValue((item.total / grandTotal) * 100) : 0,
    }))
    .sort((left, right) => right.total - left.total);
}

/* ───────── Top payees ───────────────────────────────────────── */

export async function getTopPayees(filters: FinanceFilters, limit = 15): Promise<TopPayee[]> {
  const rows = await listFilteredFinanceRows(filters);
  const payeeMap = new Map<string, { payee: string; total: number; count: number }>();

  for (const row of rows) {
    if (row.type !== "expense") continue;
    const existing = payeeMap.get(row.payee) ?? { payee: row.payee, total: 0, count: 0 };
    existing.total += row.amount;
    existing.count += 1;
    payeeMap.set(row.payee, existing);
  }

  return Array.from(payeeMap.values())
    .sort((left, right) => right.total - left.total)
    .slice(0, limit)
    .map((item) => ({
      payee: item.payee,
      total: roundValue(item.total),
      count: item.count,
    }));
}

/* ───────── Summary KPIs ─────────────────────────────────────── */

export async function getFinanceSummary(userId: number): Promise<FinanceSummary> {
  const accs = await getAccountsWithBalance(userId);
  const totalBalance = accs
    .filter((account) => !account.archived)
    .reduce((sum, account) => sum + account.balance, 0);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = `${currentMonth}-01`;
  const monthEnd = `${currentMonth}-31`;

  const trends = await getMonthlyTrends({ userId, from: monthStart, to: monthEnd });
  const current = trends.find((item) => item.month === currentMonth);

  return {
    totalBalance: roundValue(totalBalance),
    monthExpenses: current?.expenses ?? 0,
    monthIncome: current?.income ?? 0,
    monthSavings: current?.savings ?? 0,
  };
}

/* ───────── Aggregated analytics ─────────────────────────────── */

export async function getFinanceAnalytics(filters: FinanceFilters): Promise<FinanceAnalyticsData> {
  const [rows, accountBalances] = await Promise.all([
    listFilteredFinanceRows(filters),
    getAccountsWithBalance(filters.userId),
  ]);

  const months = buildMonthRange(filters, rows);
  const monthlyMap = new Map<string, FinanceAnalyticsMonth>(
    months.map((month) => [month, { month, income: 0, expenses: 0, net: 0, transactionCount: 0 }]),
  );

  const categoryMap = new Map<string, Omit<FinanceAnalyticsCategoryItem, "percentage">>();
  const groupMap = new Map<string, Omit<FinanceAnalyticsGroupItem, "percentage">>();
  const payeeMap = new Map<string, Omit<FinanceAnalyticsPayeeItem, "percentage">>();
  const accountMap = new Map<number, FinanceAnalyticsAccountItem>();
  const weekdayMap = new Map<number, FinanceAnalyticsWeekdayItem>(
    WEEKDAY_LABELS.map((weekdayLabel, weekdayIndex) => [weekdayIndex, {
      weekdayIndex,
      weekdayLabel,
      income: 0,
      expenses: 0,
      net: 0,
      transactionCount: 0,
    }]),
  );
  const monthlyCategoryMap = new Map<string, FinanceAnalyticsMonthBucket>();
  const monthlyGroupMap = new Map<string, FinanceAnalyticsMonthBucket>();

  for (const account of accountBalances) {
    if (filters.accountId && account.id !== filters.accountId) continue;
    accountMap.set(account.id, {
      accountId: account.id,
      accountName: account.name,
      color: account.color,
      balance: roundValue(account.balance),
      income: 0,
      expenses: 0,
      net: 0,
      transactionCount: 0,
    });
  }

  for (const row of rows) {
    const month = getMonthKey(row.date);
    const monthlyEntry = monthlyMap.get(month);
    if (!monthlyEntry) continue;

    monthlyEntry.transactionCount += 1;
    if (row.type === "income") {
      monthlyEntry.income += row.amount;
    } else {
      monthlyEntry.expenses += row.amount;
    }

    const accountEntry = accountMap.get(row.accountId) ?? {
      accountId: row.accountId,
      accountName: row.accountName,
      color: row.accountColor,
      balance: 0,
      income: 0,
      expenses: 0,
      net: 0,
      transactionCount: 0,
    };

    accountEntry.transactionCount += 1;
    if (row.type === "income") {
      accountEntry.income += row.amount;
    } else {
      accountEntry.expenses += row.amount;
    }
    accountMap.set(row.accountId, accountEntry);

    const weekdayIndex = getWeekdayIndex(row.date);
    const weekdayEntry = weekdayMap.get(weekdayIndex);
    if (weekdayEntry) {
      weekdayEntry.transactionCount += 1;
      if (row.type === "income") {
        weekdayEntry.income += row.amount;
      } else {
        weekdayEntry.expenses += row.amount;
      }
    }

    const categoryKey = `${row.type}:${row.categoryId ?? "none"}`;
    const categoryEntry = categoryMap.get(categoryKey) ?? {
      bucketKey: categoryKey,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      groupId: row.groupId,
      groupName: row.groupName,
      type: row.type,
      total: 0,
      count: 0,
    };
    categoryEntry.total += row.amount;
    categoryEntry.count += 1;
    categoryMap.set(categoryKey, categoryEntry);

    const groupKey = `${row.type}:${row.groupId ?? "none"}`;
    const groupEntry = groupMap.get(groupKey) ?? {
      bucketKey: groupKey,
      groupId: row.groupId,
      groupName: row.groupName,
      type: row.type,
      total: 0,
      count: 0,
    };
    groupEntry.total += row.amount;
    groupEntry.count += 1;
    groupMap.set(groupKey, groupEntry);

    const payeeKey = `${row.type}:${row.payee}`;
    const payeeEntry = payeeMap.get(payeeKey) ?? {
      bucketKey: payeeKey,
      payee: row.payee,
      type: row.type,
      total: 0,
      count: 0,
    };
    payeeEntry.total += row.amount;
    payeeEntry.count += 1;
    payeeMap.set(payeeKey, payeeEntry);

    const monthlyCategoryKey = `${month}:${categoryKey}`;
    const monthlyCategoryEntry = monthlyCategoryMap.get(monthlyCategoryKey) ?? {
      month,
      bucketKey: categoryKey,
      bucketId: row.categoryId,
      label: row.categoryName,
      parentLabel: row.groupName,
      type: row.type,
      total: 0,
    };
    monthlyCategoryEntry.total += row.amount;
    monthlyCategoryMap.set(monthlyCategoryKey, monthlyCategoryEntry);

    const monthlyGroupKey = `${month}:${groupKey}`;
    const monthlyGroupEntry = monthlyGroupMap.get(monthlyGroupKey) ?? {
      month,
      bucketKey: groupKey,
      bucketId: row.groupId,
      label: row.groupName,
      parentLabel: null,
      type: row.type,
      total: 0,
    };
    monthlyGroupEntry.total += row.amount;
    monthlyGroupMap.set(monthlyGroupKey, monthlyGroupEntry);
  }

  const monthly = Array.from(monthlyMap.values()).map((item) => ({
    ...item,
    income: roundValue(item.income),
    expenses: roundValue(item.expenses),
    net: roundValue(item.income - item.expenses),
  }));

  const accountsData = Array.from(accountMap.values())
    .map((item) => ({
      ...item,
      income: roundValue(item.income),
      expenses: roundValue(item.expenses),
      net: roundValue(item.income - item.expenses),
      balance: roundValue(item.balance),
    }))
    .sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance) || right.expenses - left.expenses);

  const weekdays = Array.from(weekdayMap.values()).map((item) => ({
    ...item,
    income: roundValue(item.income),
    expenses: roundValue(item.expenses),
    net: roundValue(item.income - item.expenses),
  }));

  const monthlyCategories = Array.from(monthlyCategoryMap.values())
    .map((item) => ({ ...item, total: roundValue(item.total) }))
    .sort((left, right) => left.month.localeCompare(right.month) || right.total - left.total);

  const monthlyGroups = Array.from(monthlyGroupMap.values())
    .map((item) => ({ ...item, total: roundValue(item.total) }))
    .sort((left, right) => left.month.localeCompare(right.month) || right.total - left.total);

  const incomeTotal = monthly.reduce((sum, item) => sum + item.income, 0);
  const expenseTotal = monthly.reduce((sum, item) => sum + item.expenses, 0);
  const visibleMonths = Math.max(monthly.length, 1);
  const filteredBalances = accountBalances.filter(
    (account) => (!filters.accountId || account.id === filters.accountId) && (!account.archived || Boolean(filters.accountId)),
  );
  const totalBalance = filteredBalances.reduce((sum, account) => sum + account.balance, 0);

  const topIncomeMonth = monthly.reduce<FinanceAnalyticsSummary["topIncomeMonth"]>((currentTop, item) => {
    if (item.income <= 0) return currentTop;
    if (!currentTop || item.income > currentTop.total) {
      return { month: item.month, total: item.income };
    }
    return currentTop;
  }, null);

  const topExpenseMonth = monthly.reduce<FinanceAnalyticsSummary["topExpenseMonth"]>((currentTop, item) => {
    if (item.expenses <= 0) return currentTop;
    if (!currentTop || item.expenses > currentTop.total) {
      return { month: item.month, total: item.expenses };
    }
    return currentTop;
  }, null);

  return {
    summary: {
      totalBalance: roundValue(totalBalance),
      incomeTotal: roundValue(incomeTotal),
      expenseTotal: roundValue(expenseTotal),
      netTotal: roundValue(incomeTotal - expenseTotal),
      monthlyAverageIncome: roundValue(incomeTotal / visibleMonths),
      monthlyAverageExpenses: roundValue(expenseTotal / visibleMonths),
      savingsRate: incomeTotal > 0 ? roundValue(((incomeTotal - expenseTotal) / incomeTotal) * 100) : 0,
      visibleMonths,
      transactionCount: rows.length,
      topIncomeMonth: topIncomeMonth
        ? { month: topIncomeMonth.month, total: roundValue(topIncomeMonth.total) }
        : null,
      topExpenseMonth: topExpenseMonth
        ? { month: topExpenseMonth.month, total: roundValue(topExpenseMonth.total) }
        : null,
    },
    monthly,
    categories: finalizeBreakdownByType(Array.from(categoryMap.values())),
    groups: finalizeBreakdownByType(Array.from(groupMap.values())),
    payees: finalizeBreakdownByType(Array.from(payeeMap.values())),
    accounts: accountsData,
    weekdays,
    monthlyCategories,
    monthlyGroups,
  };
}
