import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, categoryGroups, transactions } from "../db/schema.js";
import { effectiveTransaction } from "./transaction-filters.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";
import type { ReportRow } from "./month-report.service.js";

export interface YearTotals {
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
}

export interface YearReport {
  year: number;
  /** Año en curso: se compara con el mismo periodo del anterior (hasta `throughMonth`). */
  partial: boolean;
  throughMonth: number;
  totals: YearTotals;
  previousTotals: YearTotals;
  months: Array<{ month: string } & YearTotals>;
  bestMonth: { month: string; net: number } | null;
  worstMonth: { month: string; net: number } | null;
  categories: Array<{ categoryId: number | null; name: string; groupName: string; spent: number; previous: number; diffPct: number | null }>;
  topPayees: Array<{ payee: string; spent: number; count: number }>;
  biggestExpenses: Array<{ id: number; date: string; payee: string; amount: number; categoryName: string }>;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

function totalsOf(rows: ReportRow[]): YearTotals {
  const income = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const expense = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
  return { income: round(income), expense: round(expense), net: round(income - expense), savingsRate: income > 0 ? round(((income - expense) / income) * 100) : null };
}

/** Informe de un año a partir de los movimientos de ese año y del anterior (puro, probado). */
export function buildYearReport(rows: ReportRow[], year: number, today: string = getTodayIsoDate()): YearReport {
  const [ty, tm] = today.split("-").map(Number);
  const partial = year === ty;
  const throughMonth = partial ? tm : 12;
  const inYear = (r: ReportRow, y: number) => r.date.startsWith(`${y}-`) && Number(r.date.slice(5, 7)) <= throughMonth;
  const current = rows.filter((r) => inYear(r, year));
  const previous = rows.filter((r) => inYear(r, year - 1));

  const months = Array.from({ length: throughMonth }, (_, i) => {
    const key = `${year}-${pad(i + 1)}`;
    return { month: key, ...totalsOf(current.filter((r) => r.date.startsWith(key))) };
  });
  // El mes en curso no compite por «mejor/peor»: aún no ha terminado.
  const complete = months.filter((m) => !(partial && m.month === `${year}-${pad(tm)}`) && (m.income > 0 || m.expense > 0));
  const best = complete.reduce<YearReport["bestMonth"]>((a, m) => (!a || m.net > a.net ? { month: m.month, net: m.net } : a), null);
  const worst = complete.reduce<YearReport["worstMonth"]>((a, m) => (!a || m.net < a.net ? { month: m.month, net: m.net } : a), null);

  const byCategory = new Map<string, { categoryId: number | null; name: string; groupName: string; spent: number; previous: number }>();
  for (const r of [...current, ...previous]) {
    if (r.type !== "expense") continue;
    const key = String(r.categoryId ?? "none");
    const c = byCategory.get(key) ?? { categoryId: r.categoryId, name: r.categoryName, groupName: r.groupName, spent: 0, previous: 0 };
    if (r.date.startsWith(`${year}-`)) c.spent += r.amount;
    else c.previous += r.amount;
    byCategory.set(key, c);
  }
  const cats = [...byCategory.values()]
    .filter((c) => c.spent > 0)
    .map((c) => ({ ...c, spent: round(c.spent), previous: round(c.previous), diffPct: c.previous > 0 ? round(((c.spent - c.previous) / c.previous) * 100) : null }))
    .sort((a, b) => b.spent - a.spent);

  const byPayee = new Map<string, { payee: string; spent: number; count: number }>();
  for (const r of current) {
    if (r.type !== "expense") continue;
    const key = r.payee.trim().toLowerCase();
    const p = byPayee.get(key) ?? { payee: r.payee, spent: 0, count: 0 };
    p.spent += r.amount;
    p.count++;
    byPayee.set(key, p);
  }

  return {
    year,
    partial,
    throughMonth,
    totals: totalsOf(current),
    previousTotals: totalsOf(previous),
    months,
    bestMonth: best,
    worstMonth: worst && best && worst.month !== best.month ? worst : null,
    categories: cats.slice(0, 12),
    topPayees: [...byPayee.values()].map((p) => ({ ...p, spent: round(p.spent) })).sort((a, b) => b.spent - a.spent).slice(0, 10),
    biggestExpenses: current
      .filter((r) => r.type === "expense")
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((r) => ({ id: r.id, date: r.date, payee: r.payee, amount: r.amount, categoryName: r.categoryName })),
  };
}

export async function getYearReport(userId: number, year: number): Promise<YearReport> {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categoryName: sql<string>`coalesce(${categories.name}, 'Sin categoría')`,
      groupName: sql<string>`coalesce(${categoryGroups.name}, 'Sin grupo')`,
      payee: sql<string>`coalesce(nullif(${transactions.payee}, ''), 'Sin beneficiario')`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(
      eq(transactions.userId, userId),
      effectiveTransaction(),
      sql`${transactions.type} in ('income', 'expense')`,
      gte(transactions.date, `${year - 1}-01-01`),
      lte(transactions.date, `${year}-12-31`),
    ))
    .orderBy(asc(transactions.date), asc(transactions.id));
  return buildYearReport(rows.filter((r): r is typeof r & { type: "income" | "expense" } => r.type === "income" || r.type === "expense"), year);
}
