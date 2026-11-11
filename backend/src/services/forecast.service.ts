import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgets, recurringTransactions, transactions } from "../db/schema.js";
import { lastDayOfMonth } from "../utils/dates.js";
import { getAccountsWithBalance } from "./finance.service.js";
import { getTodayIsoDate, listOccurrenceDates, skippedOccurrenceKeys } from "./recurring-transactions.service.js";

/* ───────── Previsión de saldo ───────────────────────────────────
 * Saldo de hoy + lo que ya está previsto: movimientos pendientes y próximas
 * ocurrencias de las recurrentes que aún no se han generado como movimiento.
 * No inventa nada: solo proyecta lo que el usuario ya ha programado.
 *
 * Con `accountId`, el de una cuenta (incluidos sus traspasos). Con `budget`,
 * además un escenario «si gasto lo presupuestado»: lo que queda por gastar de
 * cada categoría, repartido por igual en los días que le quedan al mes.
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

export interface ForecastScenario {
  points: ForecastPoint[];
  endOfMonth: ForecastPoint;
  lowest: ForecastPoint;
  firstNegative: string | null;
  /** Presupuesto que queda por gastar, por mes ("YYYY-MM"), ya descontado lo programado. */
  remainingByMonth: Array<{ month: string; amount: number }>;
}

export interface ForecastResult extends Forecast {
  accountId: number | null;
  /** Solo si se pidió (y sin cuenta: el presupuesto no va por cuentas). */
  scenario: ForecastScenario | null;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

export function addDaysIso(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Tope de la lista de próximos movimientos (con 365 días puede ser larga). */
const UPCOMING_LIMIT = 200;

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

  const eom = lastDayOfMonth(today.slice(0, 7));
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

/* ───────── Escenario «si gasto lo presupuestado» ──────────────── */

export interface BudgetMonthInput {
  month: string;
  /** Asignado por categoría en ese mes. */
  assigned: Map<number, number>;
  /** Gasto ya apuntado (liquidado o no) por categoría en ese mes, en positivo. */
  spent: Map<number, number>;
  /** Recurrentes aún sin generar que caen ese mes, por categoría, en positivo. */
  scheduled: Map<number, number>;
}

/**
 * Lo que queda por gastar de cada categoría (asignado − gastado − programado,
 * nunca negativo) repartido por igual entre los días que le quedan a cada
 * mes desde hoy. Puro: devuelve un gasto por día y el total por mes.
 */
export function budgetScenarioItems(today: string, horizon: string, months: BudgetMonthInput[]) {
  const daily = new Map<string, number>();
  const remainingByMonth: Array<{ month: string; amount: number }> = [];
  for (const m of months) {
    let remaining = 0;
    for (const [categoryId, assigned] of m.assigned) {
      remaining += Math.max(0, assigned - (m.spent.get(categoryId) ?? 0) - (m.scheduled.get(categoryId) ?? 0));
    }
    remainingByMonth.push({ month: m.month, amount: roundCents(remaining) });
    if (remaining <= 0) continue;
    const first = m.month === today.slice(0, 7) ? today : `${m.month}-01`;
    const last = lastDayOfMonth(m.month);
    const span = Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
    for (let d = 0; d < span; d++) {
      const date = addDaysIso(first, d);
      if (date > horizon) break;
      daily.set(date, (daily.get(date) ?? 0) + remaining / span);
    }
  }
  const items = [...daily].map(([date, amount]) => ({ date, amount: -amount, payee: "Presupuesto", source: "pending" as const }));
  return { items, remainingByMonth };
}

function monthsInRange(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let [y, m] = fromDate.split("-").map(Number);
  const end = toDate.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) return out;
    m++;
    if (m > 12) { m = 1; y++; }
  }
}

export interface ForecastOptions {
  accountId?: number | null;
  budget?: boolean;
}

type PlannedItem = Omit<ForecastItem, "overdue"> & { categoryId: number | null; isExpense: boolean };

/** Deuda a largo plazo: no es dinero disponible, así que la previsión en total no la cuenta. */
const LONG_TERM_DEBT = new Set(["loan", "mortgage"]);

export async function getForecast(userId: number, days = 90, options: ForecastOptions = {}): Promise<ForecastResult> {
  const today = getTodayIsoDate();
  const horizon = addDaysIso(today, days);
  const accountId = options.accountId ?? null;

  // Las cuentas que se prevén: una, o en total las activas que son dinero
  // disponible (sin préstamos ni hipotecas: con una hipoteca, «tu saldo total
  // quedaría en negativo» no tendría sentido). Un traspaso entre dos cuentas de
  // este conjunto se anula solo; uno hacia fuera (la cuota de la hipoteca) resta.
  const balances = await getAccountsWithBalance(userId);
  const pool = balances.filter((a) => !a.archived && (accountId ? a.id === accountId : !LONG_TERM_DEBT.has(a.type)));
  const poolIds = pool.map((a) => a.id);
  const inPool = (id: number | null) => id != null && poolIds.includes(id);

  const [pending, rules, generated] = await Promise.all([
    poolIds.length === 0
      ? []
      : db
          .select({
            id: transactions.id,
            date: transactions.date,
            amount: transactions.amount,
            type: transactions.type,
            payee: transactions.payee,
            transferId: transactions.transferId,
            categoryId: transactions.categoryId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.cleared, false),
              inArray(transactions.accountId, poolIds),
              lte(transactions.date, horizon),
            ),
          ),
    db
      .select({ rule: recurringTransactions })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          eq(recurringTransactions.active, true),
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
  for (const key of await skippedOccurrenceKeys(rules.map(({ rule }) => rule.id))) existing.add(key);
  const items: PlannedItem[] = pending.map((p) => ({
    date: p.date,
    // Misma regla que el saldo: de un traspaso, la pata con el id más alto es la salida.
    amount: p.type === "income" || (p.type === "transfer" && p.transferId != null && p.transferId < p.id) ? p.amount : -p.amount,
    payee: p.payee || (p.type === "transfer" ? "Traspaso" : "Sin beneficiario"),
    source: "pending" as const,
    categoryId: p.categoryId,
    isExpense: p.type === "expense",
  }));
  // Dos patas de un mismo traspaso dentro del conjunto se anulan: fuera de la lista.
  const pendingIds = new Set(pending.map((p) => p.id));
  const internal = new Set(pending.filter((p) => p.type === "transfer" && p.transferId != null && pendingIds.has(p.transferId)).map((p) => p.id));
  for (let i = items.length - 1; i >= 0; i--) if (internal.has(pending[i].id)) items.splice(i, 1);

  for (const { rule } of rules) {
    let sign: number;
    if (rule.type === "transfer") {
      // Entra si el destino está en el conjunto y sale si lo está el origen: entre dos, nada.
      sign = (inPool(rule.targetAccountId) ? 1 : 0) - (inPool(rule.accountId) ? 1 : 0);
    } else {
      sign = inPool(rule.accountId) ? (rule.type === "income" ? 1 : -1) : 0;
    }
    if (sign === 0) continue;
    const dates = listOccurrenceDates(
      { startDate: rule.startDate, endDate: rule.endDate, cadence: rule.cadence, intervalCount: rule.intervalCount },
      horizon,
    );
    for (const date of dates) {
      if (date < today || existing.has(`${rule.id}:${date}`)) continue;
      items.push({
        date,
        amount: sign * rule.amount,
        payee: rule.payee || (rule.type === "transfer" ? "Traspaso recurrente" : "Pago recurrente"),
        source: "recurring",
        categoryId: rule.categoryId,
        isExpense: rule.type === "expense",
      });
    }
  }

  const startBalance = pool.reduce((s, a) => s + a.balance, 0);
  const plain = items.map(({ categoryId: _c, isExpense: _e, ...rest }) => rest);
  const forecast = buildForecast({ startBalance, today, days, items: plain });

  let scenario: ForecastScenario | null = null;
  if (options.budget && !accountId) {
    const months = await budgetMonths(userId, today, horizon, items);
    const extra = budgetScenarioItems(today, horizon, months);
    const withBudget = buildForecast({ startBalance, today, days, items: [...plain, ...extra.items] });
    scenario = {
      points: withBudget.points,
      endOfMonth: withBudget.endOfMonth,
      lowest: withBudget.lowest,
      firstNegative: withBudget.firstNegative,
      remainingByMonth: extra.remainingByMonth,
    };
  }

  return { ...forecast, accountId, scenario };
}

/** Asignado, gastado y programado por categoría para cada mes del horizonte. */
async function budgetMonths(userId: number, today: string, horizon: string, planned: PlannedItem[]): Promise<BudgetMonthInput[]> {
  const months = monthsInRange(today, horizon);
  const [budgetRows, spentRows] = await Promise.all([
    db
      .select({ month: budgets.month, categoryId: budgets.categoryId, assigned: budgets.assigned })
      .from(budgets)
      .where(and(eq(budgets.userId, userId), lte(budgets.month, months[months.length - 1]))),
    db
      .select({ date: transactions.date, categoryId: transactions.categoryId, amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "expense"),
          isNotNull(transactions.categoryId),
          gte(transactions.date, `${months[0]}-01`),
          lte(transactions.date, lastDayOfMonth(months[months.length - 1])),
        ),
      ),
  ]);

  // Un mes sin presupuesto propio repite el del último mes que lo tenga (hasta hoy).
  const byMonth = new Map<string, Map<number, number>>();
  for (const r of budgetRows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map());
    byMonth.get(r.month)!.set(r.categoryId, r.assigned);
  }
  const known = [...byMonth.keys()].sort();
  const assignedFor = (month: string) => {
    const own = byMonth.get(month);
    if (own) return own;
    const prev = known.filter((k) => k <= month).pop();
    return prev ? byMonth.get(prev)! : new Map<number, number>();
  };

  return months.map((month) => {
    const spent = new Map<number, number>();
    for (const r of spentRows) {
      if (r.date.slice(0, 7) !== month || r.categoryId == null) continue;
      spent.set(r.categoryId, (spent.get(r.categoryId) ?? 0) + r.amount);
    }
    const scheduled = new Map<number, number>();
    for (const i of planned) {
      // Lo pendiente ya está en `spent` (es un movimiento); aquí solo las recurrentes sin generar.
      if (i.source !== "recurring" || !i.isExpense || i.categoryId == null || i.date.slice(0, 7) !== month) continue;
      scheduled.set(i.categoryId, (scheduled.get(i.categoryId) ?? 0) + Math.abs(i.amount));
    }
    return { month, assigned: assignedFor(month), spent, scheduled };
  });
}
