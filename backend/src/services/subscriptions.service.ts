import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { recurringTransactions, transactions } from "../db/schema.js";
import { median } from "../utils/math.js";
import { normalizeText } from "../utils/text.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";
import { effectiveTransaction } from "./transaction-filters.js";

/* ───────── Detección de suscripciones ───────────────────────────
 * Gastos que se repiten cada mes con un importe parecido y que aún no están
 * programados como recurrentes. Se proponen para crear la regla; nada se
 * crea solo.
 */

export interface SubscriptionRow {
  id: number;
  date: string;
  amount: number;
  payee: string;
  categoryId: number | null;
  accountId: number;
  recurringTransactionId: number | null;
}

export type SubscriptionCadence = "weekly" | "monthly" | "yearly";

export interface SubscriptionSuggestion {
  payee: string;
  cadence: SubscriptionCadence;
  /** Mediana de los cargos. */
  amount: number;
  /** Lo que supone al mes (para sumar el coste de todas las suscripciones). */
  monthlyAmount: number;
  occurrences: number;
  lastDate: string;
  /** Un mes después del último cargo. */
  nextDate: string;
  categoryId: number | null;
  accountId: number;
}

const MIN_SHARE = 0.75;          // % de intervalos / importes que deben encajar

// Por frecuencia: días entre cargos, nº mínimo de cargos, margen de importe
// sobre la mediana y antigüedad máxima del último cargo. Lo semanal exige
// importes casi idénticos: si no, cualquier compra semanal (el súper) parecería
// una suscripción.
const CADENCES: Record<SubscriptionCadence, { minDays: number; maxDays: number; minCount: number; tolerance: number; activeWithin: number; perMonth: number }> = {
  weekly: { minDays: 6, maxDays: 8, minCount: 4, tolerance: 0.05, activeWithin: 14, perMonth: 52 / 12 },
  monthly: { minDays: 25, maxDays: 37, minCount: 3, tolerance: 0.15, activeWithin: 45, perMonth: 1 },
  yearly: { minDays: 350, maxDays: 380, minCount: 2, tolerance: 0.15, activeWithin: 380, perMonth: 1 / 12 },
};

const roundCents = (n: number) => Math.round(n * 100) / 100;

const dayNumber = (isoDate: string) => Math.floor(new Date(`${isoDate}T00:00:00.000Z`).getTime() / 86_400_000);

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addOneYear(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const day = Math.min(d, new Date(Date.UTC(y + 1, m, 0)).getUTCDate());
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addOneMonth(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const abs = y * 12 + m; // mes siguiente (m ya es base 1 → índice base 0 + 1)
  const ty = Math.floor(abs / 12);
  const tm = (abs % 12) + 1;
  const day = Math.min(d, new Date(Date.UTC(ty, tm, 0)).getUTCDate());
  return `${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function detectSubscriptions(
  rows: SubscriptionRow[],
  /** Beneficiarios de las recurrentes ya activas: no se vuelven a proponer. */
  activeRulePayees: string[],
  today: string,
): SubscriptionSuggestion[] {
  const covered = activeRulePayees.map(normalizeText).filter((p) => p.length >= 3);

  const groups = new Map<string, SubscriptionRow[]>();
  for (const r of rows) {
    if (r.recurringTransactionId !== null) continue; // ya viene de una regla
    const key = normalizeText(r.payee);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: SubscriptionSuggestion[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    if (covered.some((c) => key.includes(c) || c.includes(key))) continue;

    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const intervals = sorted.slice(1).map((r, i) => dayNumber(r.date) - dayNumber(sorted[i].date));
    const typical = median(sorted.map((r) => r.amount));
    if (typical <= 0) continue;

    const cadence = (Object.keys(CADENCES) as SubscriptionCadence[]).find((c) => {
      const spec = CADENCES[c];
      if (sorted.length < spec.minCount || dayNumber(today) - dayNumber(last.date) > spec.activeWithin) return false;
      const fitting = intervals.filter((d) => d >= spec.minDays && d <= spec.maxDays).length;
      if (fitting / intervals.length < MIN_SHARE) return false;
      const stable = sorted.filter((r) => Math.abs(r.amount - typical) <= typical * spec.tolerance).length;
      return stable / sorted.length >= MIN_SHARE;
    });
    if (!cadence) continue;

    out.push({
      payee: mostCommon(sorted.map((r) => r.payee.trim())) ?? last.payee,
      cadence,
      amount: roundCents(typical),
      monthlyAmount: roundCents(typical * CADENCES[cadence].perMonth),
      occurrences: sorted.length,
      lastDate: last.date,
      nextDate: cadence === "weekly" ? addDays(last.date, 7) : cadence === "yearly" ? addOneYear(last.date) : addOneMonth(last.date),
      categoryId: mostCommon(sorted.map((r) => r.categoryId)) ?? null,
      accountId: mostCommon(sorted.map((r) => r.accountId)) ?? last.accountId,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

export async function getSubscriptionSuggestions(userId: number): Promise<SubscriptionSuggestion[]> {
  const today = getTodayIsoDate();
  const [y, m, d] = today.split("-").map(Number);
  // 26 meses: lo anual necesita dos cargos para reconocerse.
  const from = new Date(Date.UTC(y, m - 1 - 26, d)).toISOString().slice(0, 10);

  const [rows, rules] = await Promise.all([
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        payee: sql<string>`coalesce(${transactions.payee}, '')`,
        categoryId: transactions.categoryId,
        accountId: transactions.accountId,
        recurringTransactionId: transactions.recurringTransactionId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          effectiveTransaction(),
          eq(transactions.type, "expense"),
          gte(transactions.date, from),
        ),
      ),
    db
      .select({ payee: recurringTransactions.payee })
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.userId, userId), eq(recurringTransactions.active, true))),
  ]);

  return detectSubscriptions(rows, rules.map((r) => r.payee ?? ""), today);
}
