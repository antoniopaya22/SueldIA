import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, transactions } from "../db/schema.js";
import type { FinanceFilters } from "./finance.service.js";
import { effectiveTransaction } from "./transaction-filters.js";

/* ───────── Series para los gráficos de la analítica ─────────────
 * Mismo criterio que el resto de la analítica: solo lo liquidado y sin
 * traspasos. Aquí van las agregaciones que no salen del endpoint principal
 * (que agrega por mes): el día a día y la distribución de importes.
 */

export interface DailyPoint {
  date: string;
  income: number;
  expense: number;
  count: number;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

function chartConditions(filters: FinanceFilters) {
  const conditions = [
    eq(transactions.userId, filters.userId),
    effectiveTransaction(),
    sql`${transactions.type} in ('income', 'expense')`,
  ];
  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));
  if (filters.accountId) conditions.push(eq(transactions.accountId, filters.accountId));
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.groupId) conditions.push(eq(categories.groupId, filters.groupId));
  return and(...conditions);
}

/** Ingresos y gastos de cada día con movimientos (los días sin movimientos no aparecen). */
export async function getDailySeries(filters: FinanceFilters): Promise<DailyPoint[]> {
  const rows = await db
    .select({
      date: transactions.date,
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
      expense: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(chartConditions(filters))
    .groupBy(transactions.date)
    .orderBy(transactions.date);
  return rows.map((r) => ({
    date: r.date,
    income: roundCents(Number(r.income)),
    expense: roundCents(Number(r.expense)),
    count: r.count,
  }));
}

/* ───────── Distribución de importes ─────────────────────────────── */

/** Límites de los tramos: <5, 5–10, 10–20, 20–50, 50–100, 100–200, 200–500, 500–1000 y ≥1000 €. */
export const AMOUNT_BUCKET_EDGES = [5, 10, 20, 50, 100, 200, 500, 1000] as const;

export interface BucketStat {
  count: number;
  total: number;
}

export interface AmountDistribution {
  edges: readonly number[];
  /** Un elemento por tramo (edges.length + 1), también los vacíos. */
  expense: BucketStat[];
  income: BucketStat[];
}

/** Rellena con ceros los tramos sin movimientos para que siempre haya un elemento por tramo (pura, probada). */
export function fillBuckets(
  rows: { bucket: number; count: number; total: number }[],
  edgesCount: number = AMOUNT_BUCKET_EDGES.length,
): BucketStat[] {
  const out: BucketStat[] = Array.from({ length: edgesCount + 1 }, () => ({ count: 0, total: 0 }));
  for (const row of rows) {
    if (row.bucket < 0 || row.bucket > edgesCount) continue;
    out[row.bucket] = { count: row.count, total: roundCents(row.total) };
  }
  return out;
}

export async function getAmountDistribution(filters: FinanceFilters): Promise<AmountDistribution> {
  const edgesSql = sql.raw(`ARRAY[${AMOUNT_BUCKET_EDGES.join(",")}]::float8[]`);
  const rows = await db
    .select({
      type: transactions.type,
      bucket: sql<number>`width_bucket(${transactions.amount}, ${edgesSql})::int`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(chartConditions(filters))
    .groupBy(transactions.type, sql`width_bucket(${transactions.amount}, ${edgesSql})`);

  const pick = (type: string) =>
    fillBuckets(rows.filter((r) => r.type === type).map((r) => ({ bucket: r.bucket, count: r.count, total: Number(r.total) })));
  return { edges: AMOUNT_BUCKET_EDGES, expense: pick("expense"), income: pick("income") };
}
