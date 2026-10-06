import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, categoryGroups, transactions } from "../db/schema.js";
import { median } from "../utils/math.js";
import { normalizeText } from "../utils/text.js";
import { shiftMonthKey } from "./budgets.service.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";
import { effectiveTransaction } from "./transaction-filters.js";

/* ───────── Informe del mes ──────────────────────────────────────
 * Compara un mes con la media de los 6 anteriores y señala lo que se sale de
 * lo habitual. Toda la lógica es pura (buildMonthReport) para poder probarla;
 * solo cuenta lo liquidado y no cuenta traspasos, igual que la analítica.
 */

export interface ReportRow {
  id: number;
  date: string;
  type: "income" | "expense";
  amount: number;
  categoryId: number | null;
  categoryName: string;
  groupName: string;
  payee: string;
}

export interface ReportCategory {
  categoryId: number | null;
  name: string;
  groupName: string;
  spent: number;
  /** Lo gastado el mes anterior. */
  previous: number;
  /** Media mensual de los meses anteriores con datos. */
  average: number;
  /** spent − average. */
  diff: number;
  /** diff / average en %; null si no había media con la que comparar. */
  diffPct: number | null;
}

export interface UnusualExpense {
  id: number;
  date: string;
  payee: string;
  amount: number;
  categoryId: number | null;
  categoryName: string;
  /** Mediana de los gastos anteriores de esa categoría. */
  typical: number;
  ratio: number;
}

export interface NewPayee {
  payee: string;
  total: number;
  count: number;
  firstDate: string;
}

export interface MonthTotals {
  income: number;
  expense: number;
  net: number;
  /** % del ingreso que se ahorra; null si no hubo ingresos. */
  savingsRate: number | null;
}

export interface MonthReport {
  month: string;
  previousMonth: string;
  /**
   * El mes no ha terminado: comparar su gasto con la media de meses completos
   * engaña (el alquiler aún no se ha pagado y parece que "gastas un 100 % menos"),
   * así que no se listan bajadas y el cliente no debe mostrar variaciones.
   */
  partial: boolean;
  totals: MonthTotals;
  previousTotals: MonthTotals;
  categories: ReportCategory[];
  increases: ReportCategory[];
  decreases: ReportCategory[];
  unusual: UnusualExpense[];
  newPayees: NewPayee[];
  /** Meses anteriores con gasto con los que se calcula la media (0 = no hay con qué comparar). */
  historyMonths: number;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

// Umbrales: lo bastante altos para no llenar el informe de ruido.
const UNUSUAL_MIN_AMOUNT = 30;
const UNUSUAL_RATIO = 2.5;
const UNUSUAL_MIN_HISTORY = 3;
const NEW_PAYEE_MIN_TOTAL = 20;
const CHANGE_MIN_AMOUNT = 10;
const TOP_N = 5;

function totalsOf(rows: ReportRow[]): MonthTotals {
  const income = roundCents(rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0));
  const expense = roundCents(rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0));
  return {
    income,
    expense,
    net: roundCents(income - expense),
    savingsRate: income > 0 ? roundCents(((income - expense) / income) * 100) : null,
  };
}

const categoryKey = (r: ReportRow) => String(r.categoryId ?? "none");
const monthOf = (date: string) => date.slice(0, 7);

/**
 * `rows` debe incluir el mes y hasta los 6 anteriores (ya filtrado a liquidados
 * y sin traspasos). Los meses "anteriores con datos" son los que tienen algún gasto.
 */
export function buildMonthReport(rows: ReportRow[], month: string, today: string = getTodayIsoDate()): MonthReport {
  const partial = month >= today.slice(0, 7);
  const previousMonth = shiftMonthKey(month, -1);
  const current = rows.filter((r) => monthOf(r.date) === month);
  const prior = rows.filter((r) => monthOf(r.date) < month);
  const previous = rows.filter((r) => monthOf(r.date) === previousMonth);

  const priorExpenses = prior.filter((r) => r.type === "expense");
  const historyMonths = new Set(priorExpenses.map((r) => monthOf(r.date))).size;

  // ── Categorías de gasto: este mes frente a la media ──
  const spentBy = new Map<string, { row: ReportRow; spent: number }>();
  for (const r of current.filter((x) => x.type === "expense")) {
    const entry = spentBy.get(categoryKey(r)) ?? { row: r, spent: 0 };
    entry.spent += r.amount;
    spentBy.set(categoryKey(r), entry);
  }
  const priorTotalBy = new Map<string, { row: ReportRow; total: number }>();
  for (const r of priorExpenses) {
    const entry = priorTotalBy.get(categoryKey(r)) ?? { row: r, total: 0 };
    entry.total += r.amount;
    priorTotalBy.set(categoryKey(r), entry);
  }
  const previousBy = new Map<string, number>();
  for (const r of previous.filter((x) => x.type === "expense")) {
    previousBy.set(categoryKey(r), (previousBy.get(categoryKey(r)) ?? 0) + r.amount);
  }

  // Categorías con gasto este mes o en la media (una que dejó de gastarse también es noticia).
  const keys = new Set([...spentBy.keys(), ...priorTotalBy.keys()]);
  const categoriesReport: ReportCategory[] = [...keys].map((key) => {
    const cur = spentBy.get(key);
    const pri = priorTotalBy.get(key);
    const row = (cur ?? pri)!.row;
    const spent = roundCents(cur?.spent ?? 0);
    const average = historyMonths > 0 ? roundCents((pri?.total ?? 0) / historyMonths) : 0;
    const diff = roundCents(spent - average);
    return {
      categoryId: row.categoryId,
      name: row.categoryName,
      groupName: row.groupName,
      spent,
      previous: roundCents(previousBy.get(key) ?? 0),
      average,
      diff,
      diffPct: average > 0 ? roundCents((diff / average) * 100) : null,
    };
  });
  categoriesReport.sort((a, b) => b.spent - a.spent || b.average - a.average);

  const comparable = historyMonths > 0 ? categoriesReport.filter((c) => Math.max(c.spent, c.average) >= CHANGE_MIN_AMOUNT) : [];
  const increases = comparable.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, TOP_N);
  // Con el mes a medias, "gastas menos" no se puede saber todavía; "gastas más" sí (ya superaste tu media).
  const decreases = partial ? [] : comparable.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, TOP_N);

  // ── Gastos inusuales: mucho más que lo típico de su categoría ──
  const priorAmountsByCategory = new Map<string, number[]>();
  for (const r of priorExpenses) {
    const list = priorAmountsByCategory.get(categoryKey(r)) ?? [];
    list.push(r.amount);
    priorAmountsByCategory.set(categoryKey(r), list);
  }
  const unusual: UnusualExpense[] = [];
  for (const r of current.filter((x) => x.type === "expense")) {
    if (r.categoryId === null || r.amount < UNUSUAL_MIN_AMOUNT) continue;
    const history = priorAmountsByCategory.get(categoryKey(r)) ?? [];
    if (history.length < UNUSUAL_MIN_HISTORY) continue;
    const typical = median(history);
    if (typical <= 0 || r.amount < typical * UNUSUAL_RATIO) continue;
    unusual.push({
      id: r.id, date: r.date, payee: r.payee, amount: r.amount,
      categoryId: r.categoryId, categoryName: r.categoryName,
      typical: roundCents(typical), ratio: roundCents(r.amount / typical),
    });
  }
  unusual.sort((a, b) => b.ratio - a.ratio);

  // ── Beneficiarios nuevos: gasto en sitios que no aparecían antes ──
  const knownPayees = [...new Set(prior.filter((r) => r.type === "expense").map((r) => normalizeText(r.payee)))];
  // "Mercadona Centro" no es nuevo si ya existía "Mercadona" (y al revés): basta que uno contenga al otro.
  const isKnown = (key: string) => knownPayees.some((k) => k === key || (Math.min(k.length, key.length) >= 4 && (k.includes(key) || key.includes(k))));
  const newBy = new Map<string, NewPayee>();
  if (historyMonths > 0) {
    for (const r of current.filter((x) => x.type === "expense")) {
      const key = normalizeText(r.payee);
      if (!key || isKnown(key)) continue;
      const entry = newBy.get(key) ?? { payee: r.payee, total: 0, count: 0, firstDate: r.date };
      entry.total += r.amount;
      entry.count += 1;
      if (r.date < entry.firstDate) entry.firstDate = r.date;
      newBy.set(key, entry);
    }
  }
  const newPayees = [...newBy.values()]
    .map((p) => ({ ...p, total: roundCents(p.total) }))
    .filter((p) => p.total >= NEW_PAYEE_MIN_TOTAL)
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_N);

  return {
    month,
    previousMonth,
    partial,
    totals: totalsOf(current),
    previousTotals: totalsOf(previous),
    categories: categoriesReport,
    increases,
    decreases,
    unusual: unusual.slice(0, TOP_N),
    newPayees,
    historyMonths,
  };
}

/** Carga los movimientos liquidados del mes y los 6 anteriores y construye el informe. */
export async function getMonthReport(userId: number, month: string): Promise<MonthReport> {
  const from = `${shiftMonthKey(month, -6)}-01`;
  const to = `${month}-31`;
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
    .where(
      and(
        eq(transactions.userId, userId),
        effectiveTransaction(),
        sql`${transactions.type} in ('income', 'expense')`,
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.id));

  return buildMonthReport(
    rows.filter((r): r is typeof r & { type: "income" | "expense" } => r.type === "income" || r.type === "expense"),
    month,
  );
}
