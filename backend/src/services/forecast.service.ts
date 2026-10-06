import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, recurringTransactions, transactions } from "../db/schema.js";
import { getAccountsWithBalance } from "./finance.service.js";
import { getTodayIsoDate, listOccurrenceDates } from "./recurring-transactions.service.js";

/* ───────── Previsión de saldo ───────────────────────────────────
 * Saldo de hoy + lo que ya está previsto: movimientos pendientes y próximas
 * ocurrencias de las recurrentes que aún no se han generado como movimiento.
 * No inventa nada: solo proyecta lo que el usuario ya ha programado.
 */

export interface ForecastItem {
  date: string;
  /** Con signo: ingreso +, gasto −. */
  amount: number;
  payee: string;
  source: "pending" | "recurring";
  /** Estaba pendiente de una fecha anterior a hoy: se cuenta hoy. */
  overdue: boolean;
}

export interface ForecastPoint {
  date: string;
  balance: number;
}

export interface Forecast {
  startBalance: number;
  today: string;
  days: number;
  points: ForecastPoint[];
  /** Próximos movimientos previstos, por fecha (los más cercanos primero). */
  upcoming: ForecastItem[];
  endOfMonth: ForecastPoint;
  lowest: ForecastPoint;
  /** Primer día en que el saldo previsto baja de cero, si ocurre. */
  firstNegative: string | null;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

export function addDaysIso(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function lastDayOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const UPCOMING_LIMIT = 15;

export function buildForecast(input: {
  startBalance: number;
  today: string;
  days: number;
  items: Omit<ForecastItem, "overdue">[];
}): Forecast {
  const { startBalance, today, days } = input;
  const horizon = addDaysIso(today, days);

  // Lo pendiente de fechas pasadas se cuenta hoy: sigue sin haber ocurrido.
  const items: ForecastItem[] = input.items
    .filter((i) => i.date <= horizon)
    .map((i) => (i.date < today ? { ...i, date: today, overdue: true } : { ...i, overdue: false }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const points: ForecastPoint[] = [];
  let balance = startBalance;
  let cursor = 0;
  for (let offset = 0; offset <= days; offset++) {
    const date = addDaysIso(today, offset);
    while (cursor < items.length && items[cursor].date <= date) balance += items[cursor++].amount;
    points.push({ date, balance: roundCents(balance) });
  }

  const eom = lastDayOfMonth(today);
  const endOfMonth = points.find((p) => p.date === eom) ?? points[points.length - 1];
  const lowest = points.reduce((min, p) => (p.balance < min.balance ? p : min), points[0]);

  return {
    startBalance: roundCents(startBalance),
    today,
    days,
    points,
    upcoming: items.slice(0, UPCOMING_LIMIT),
    endOfMonth,
    lowest,
    firstNegative: points.find((p) => p.balance < 0)?.date ?? null,
  };
}

export async function getForecast(userId: number, days = 90): Promise<Forecast> {
  const today = getTodayIsoDate();
  const horizon = addDaysIso(today, days);

  const [balances, pending, rules, generated] = await Promise.all([
    getAccountsWithBalance(userId),
    db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
        payee: transactions.payee,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.cleared, false),
          inArray(transactions.type, ["income", "expense"]),
          eq(accounts.archived, false),
          lte(transactions.date, horizon),
        ),
      ),
    db
      .select({ rule: recurringTransactions })
      .from(recurringTransactions)
      .innerJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          eq(recurringTransactions.active, true),
          eq(accounts.archived, false),
          lte(recurringTransactions.startDate, horizon),
        ),
      ),
    // Ocurrencias que ya existen como movimiento (liquidado o no): no se cuentan dos veces.
    db
      .select({ ruleId: transactions.recurringTransactionId, scheduledFor: transactions.scheduledFor })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNotNull(transactions.recurringTransactionId),
          isNotNull(transactions.scheduledFor),
          gte(transactions.scheduledFor, today),
          lte(transactions.scheduledFor, horizon),
        ),
      ),
  ]);

  const existing = new Set(generated.map((g) => `${g.ruleId}:${g.scheduledFor}`));
  const items: Omit<ForecastItem, "overdue">[] = pending.map((p) => ({
    date: p.date,
    amount: p.type === "income" ? p.amount : -p.amount,
    payee: p.payee || "Sin beneficiario",
    source: "pending" as const,
  }));

  for (const { rule } of rules) {
    const dates = listOccurrenceDates(
      { startDate: rule.startDate, endDate: rule.endDate, cadence: rule.cadence, intervalCount: rule.intervalCount },
      horizon,
    );
    for (const date of dates) {
      if (date < today || existing.has(`${rule.id}:${date}`)) continue;
      items.push({
        date,
        amount: rule.type === "income" ? rule.amount : -rule.amount,
        payee: rule.payee || "Pago recurrente",
        source: "recurring",
      });
    }
  }

  const startBalance = balances.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);
  return buildForecast({ startBalance, today, days, items });
}
