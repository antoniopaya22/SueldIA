import { z } from "zod";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, transactions } from "../db/schema.js";
import { getBudgetSummary, type BudgetSummary } from "./budgets.service.js";
import { getAccountsWithBalance, type AccountWithBalance } from "./finance.service.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";

/* ───────── Alertas de finanzas ──────────────────────────────────
 * Mismo contrato que las de nóminas (alerts.service.ts): cada evaluador
 * devuelve candidatos con una `dedupeKey` estable, y el motor los inserta con
 * ON CONFLICT DO NOTHING — repetir la evaluación (cron diario) no duplica.
 * Los constructores de candidatos son puros para poder probarlos sin BD.
 */

export interface FinanceAlertCandidate {
  severity: "info" | "warning" | "critical";
  message: string;
  payslipId: null;
  dedupeKey: string;
}

export const financeAlertConfigSchemas = {
  // Una categoría con presupuesto este mes ha gastado más de lo que tenía disponible.
  category_overspent: z.object({
    categoryId: z.number().int().positive().optional(),
    // Aviso previo al llegar a este % del presupuesto (p. ej. 80), además del de pasarse.
    warnAtPercent: z.number().int().min(50).max(99).optional(),
  }),
  // El saldo de una cuenta (o de todas, salvo tarjetas) cae por debajo de un umbral.
  low_balance: z.object({
    accountId: z.number().int().positive().optional(),
    threshold: z.number().nonnegative().max(1_000_000_000),
  }),
  // Movimientos que siguen pendientes de liquidar pasados unos días de su fecha.
  overdue_pending: z.object({
    graceDays: z.number().int().min(0).max(60).default(3),
  }),
  // El saldo total previsto (pendientes + recurrentes) baja de un importe en los próximos días.
  low_balance_forecast: z.object({
    threshold: z.number().min(-1_000_000_000).max(1_000_000_000).default(0),
    days: z.number().int().min(7).max(90).default(14),
  }),
  // Un cargo que se repite cada mes (suscripción) sube más de un % sobre lo habitual.
  subscription_price_increase: z.object({
    thresholdPercent: z.number().min(1).max(100).default(5),
  }),
  // Dos cargos iguales (cuenta, beneficiario e importe) en pocos días.
  duplicate_charge: z.object({
    windowDays: z.number().int().min(0).max(7).default(2),
    minAmount: z.number().min(0).max(1_000_000).default(5),
  }),
  // El gasto de una categoría este mes supera con mucho su media de los meses anteriores.
  unusual_category_spend: z.object({
    categoryId: z.number().int().positive().optional(),
    factor: z.number().min(1.2).max(10).default(1.5),
    minDifference: z.number().min(0).max(1_000_000).default(50),
  }),
} as const;

export type FinanceAlertType = keyof typeof financeAlertConfigSchemas;

const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

/** Clave de semana ISO ("2025-W11") de una fecha "YYYY-MM-DD": una alerta por semana como mucho. */
export function isoWeekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayNumber = (target.getUTCDay() + 6) % 7; // lunes = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function overspentCandidates(
  summary: BudgetSummary,
  config: z.infer<typeof financeAlertConfigSchemas.category_overspent>,
  ruleId: number,
): FinanceAlertCandidate[] {
  const out: FinanceAlertCandidate[] = [];
  for (const group of summary.groups) {
    for (const c of group.categories) {
      if (config.categoryId && c.id !== config.categoryId) continue;
      // Sin nada presupuestado (ni asignado ni arrastrado) no hay presupuesto que haber superado.
      const limit = c.carryIn + c.assigned;
      const over = -c.available;
      if (limit <= 0) continue;
      const spent = limit - c.available;
      if (over < 0.01) {
        // Aún dentro del presupuesto: aviso previo si se ha pedido y ya se ha llegado a ese %.
        if (config.warnAtPercent && spent >= limit * (config.warnAtPercent / 100)) {
          out.push({
            severity: "info",
            message: `"${c.name}" lleva gastado el ${Math.floor((spent / limit) * 100)} % de su presupuesto de ${monthLabel(summary.month)} (${eur(spent)} de ${eur(limit)}).`,
            payslipId: null,
            dedupeKey: `budget_near:${ruleId}:${c.id}:${summary.month}`,
          });
        }
        continue;
      }
      out.push({
        severity: over > limit * 0.5 ? "critical" : "warning",
        message: `"${c.name}" se ha pasado ${eur(over)} del presupuesto de ${monthLabel(summary.month)} (tenías ${eur(limit)}).`,
        payslipId: null,
        dedupeKey: `overspent:${ruleId}:${c.id}:${summary.month}`,
      });
    }
  }
  return out;
}

export function lowBalanceCandidates(
  accounts: Pick<AccountWithBalance, "id" | "name" | "type" | "archived" | "balance">[],
  config: z.infer<typeof financeAlertConfigSchemas.low_balance>,
  month: string,
  ruleId: number,
): FinanceAlertCandidate[] {
  return accounts
    .filter((a) => !a.archived)
    // Una tarjeta, un préstamo o una hipoteca en negativo es lo normal: solo se vigilan si se eligen a propósito.
    .filter((a) => (config.accountId ? a.id === config.accountId : !["credit_card", "loan", "mortgage"].includes(a.type)))
    .filter((a) => a.balance < config.threshold)
    .map((a) => ({
      severity: a.balance < 0 ? ("critical" as const) : ("warning" as const),
      message: `El saldo de "${a.name}" (${eur(a.balance)}) está por debajo de ${eur(config.threshold)}.`,
      payslipId: null,
      // Una vez al mes por cuenta: el saldo sigue bajo cada día y no debe repetirse a diario.
      dedupeKey: `low_balance:${ruleId}:${a.id}:${month}`,
    }));
}

export function overdueCandidates(
  pending: { date: string; amount: number }[],
  config: z.infer<typeof financeAlertConfigSchemas.overdue_pending>,
  today: string,
  ruleId: number,
): FinanceAlertCandidate[] {
  const cutoff = addDaysIso(today, -config.graceDays);
  const late = pending.filter((p) => p.date < cutoff);
  if (late.length === 0) return [];
  const total = late.reduce((sum, p) => sum + p.amount, 0);
  return [
    {
      severity: "info",
      message: `Tienes ${late.length} ${late.length === 1 ? "movimiento pendiente" : "movimientos pendientes"} con más de ${config.graceDays} ${config.graceDays === 1 ? "día" : "días"} de retraso (${eur(total)} en total). Revísalos y márcalos como liquidados.`,
      payslipId: null,
      dedupeKey: `overdue:${ruleId}:${isoWeekKey(today)}`,
    },
  ];
}

export function forecastCandidates(
  points: Array<{ date: string; balance: number }>,
  config: z.infer<typeof financeAlertConfigSchemas.low_balance_forecast>,
  today: string,
  ruleId: number,
): FinanceAlertCandidate[] {
  const horizon = addDaysIso(today, config.days);
  const first = points.find((p) => p.date > today && p.date <= horizon && p.balance < config.threshold);
  if (!first) return [];
  const lowest = points.filter((p) => p.date > today && p.date <= horizon).reduce((a, b) => (b.balance < a.balance ? b : a), first);
  const day = new Date(`${first.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  return [{
    severity: lowest.balance < 0 ? "critical" : "warning",
    message: `Con lo pendiente y lo programado, tu saldo bajaría de ${eur(config.threshold)} el ${day} (mínimo previsto: ${eur(lowest.balance)}).`,
    payslipId: null,
    // Una vez por semana: la previsión se recalcula cada día.
    dedupeKey: `low_forecast:${ruleId}:${isoWeekKey(today)}`,
  }];
}

const normPayee = (p: string | null) => (p ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export interface ChargeRow { id: number; date: string; amount: number; payee: string | null; accountId: number; recurringTransactionId?: number | null }

/**
 * Subida de precio: el último cargo de un beneficiario que se cobra cada mes
 * (al menos 3 cargos previos a 25–37 días unos de otros) supera la mediana
 * de los anteriores en más del umbral. Solo cargos recientes (14 días).
 */
export function priceIncreaseCandidates(
  rows: ChargeRow[],
  config: z.infer<typeof financeAlertConfigSchemas.subscription_price_increase>,
  today: string,
  ruleId: number,
): FinanceAlertCandidate[] {
  const byPayee = new Map<string, ChargeRow[]>();
  for (const r of rows) {
    const key = normPayee(r.payee);
    if (!key) continue;
    byPayee.set(key, [...(byPayee.get(key) ?? []), r]);
  }
  const out: FinanceAlertCandidate[] = [];
  for (const charges of byPayee.values()) {
    const sorted = [...charges].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const last = sorted[sorted.length - 1];
    const previous = sorted.slice(0, -1).slice(-6);
    if (previous.length < 3 || dayNum(today) - dayNum(last.date) > 14) continue;
    const gaps = [...previous, last].slice(1).map((c, i) => dayNum(c.date) - dayNum([...previous, last][i].date));
    if (!gaps.every((g) => g >= 25 && g <= 37)) continue;
    const usual = median(previous.map((c) => c.amount));
    if (usual <= 0 || last.amount <= usual * (1 + config.thresholdPercent / 100)) continue;
    const pct = ((last.amount - usual) / usual) * 100;
    out.push({
      severity: "info",
      message: `"${last.payee}" te ha cobrado ${eur(last.amount)}, un ${pct.toLocaleString("es-ES", { maximumFractionDigits: 0 })} % más que de costumbre (${eur(usual)}).`,
      payslipId: null,
      dedupeKey: `price_up:${ruleId}:${last.id}`,
    });
  }
  return out;
}

/** Dos cargos iguales (misma cuenta, beneficiario e importe) separados como mucho `windowDays`. */
export function duplicateChargeCandidates(
  rows: ChargeRow[],
  config: z.infer<typeof financeAlertConfigSchemas.duplicate_charge>,
  ruleId: number,
): FinanceAlertCandidate[] {
  const out: FinanceAlertCandidate[] = [];
  const seen = new Set<number>();
  const sorted = [...rows].filter((r) => r.amount >= config.minAmount && normPayee(r.payee)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (seen.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (dayNum(b.date) - dayNum(a.date) > config.windowDays) break;
      if (seen.has(b.id) || a.accountId !== b.accountId || Math.abs(a.amount - b.amount) > 0.005 || normPayee(a.payee) !== normPayee(b.payee)) continue;
      seen.add(a.id).add(b.id);
      out.push({
        severity: "warning",
        message: `Posible cargo duplicado: "${a.payee}" de ${eur(a.amount)} dos veces (${a.date === b.date ? `el ${a.date.split("-").reverse().join("/")}` : `el ${a.date.split("-").reverse().join("/")} y el ${b.date.split("-").reverse().join("/")}`}).`,
        payslipId: null,
        dedupeKey: `duplicate:${ruleId}:${a.id}:${b.id}`,
      });
      break;
    }
  }
  return out;
}

export interface CategoryMonthSpend { categoryId: number; name: string; month: string; spent: number }

/**
 * Gasto inusual: lo gastado este mes en una categoría es al menos `factor`
 * veces su media de los meses anteriores con gasto (hace falta historial de 3).
 */
export function unusualSpendCandidates(
  rows: CategoryMonthSpend[],
  config: z.infer<typeof financeAlertConfigSchemas.unusual_category_spend>,
  month: string,
  ruleId: number,
): FinanceAlertCandidate[] {
  const byCategory = new Map<number, CategoryMonthSpend[]>();
  for (const r of rows) {
    if (config.categoryId && r.categoryId !== config.categoryId) continue;
    byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);
  }
  const out: FinanceAlertCandidate[] = [];
  for (const items of byCategory.values()) {
    const current = items.find((r) => r.month === month);
    const history = items.filter((r) => r.month < month && r.spent > 0);
    if (!current || history.length < 3) continue;
    const avg = history.reduce((s, r) => s + r.spent, 0) / history.length;
    if (current.spent < avg * config.factor || current.spent - avg < config.minDifference) continue;
    out.push({
      severity: "info",
      message: `Este mes llevas ${eur(current.spent)} en "${current.name}", bastante más que tu media (${eur(avg)}).`,
      payslipId: null,
      dedupeKey: `unusual:${ruleId}:${current.categoryId}:${month}`,
    });
  }
  return out;
}

/* ───────── Evaluadores (con BD) ────────────────────────────────── */

export async function evalCategoryOverspent(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.category_overspent>,
): Promise<FinanceAlertCandidate[]> {
  const month = getTodayIsoDate().slice(0, 7);
  return overspentCandidates(await getBudgetSummary(userId, month), config, ruleId);
}

export async function evalLowBalance(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.low_balance>,
): Promise<FinanceAlertCandidate[]> {
  const month = getTodayIsoDate().slice(0, 7);
  return lowBalanceCandidates(await getAccountsWithBalance(userId), config, month, ruleId);
}

export async function evalOverduePending(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.overdue_pending>,
): Promise<FinanceAlertCandidate[]> {
  const today = getTodayIsoDate();
  const cutoff = addDaysIso(today, -config.graceDays);
  const rows = await db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.cleared, false), lt(transactions.date, cutoff)));
  return overdueCandidates(rows, config, today, ruleId);
}

export async function evalLowBalanceForecast(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.low_balance_forecast>,
): Promise<FinanceAlertCandidate[]> {
  const { getForecast } = await import("./forecast.service.js");
  const forecast = await getForecast(userId, config.days);
  return forecastCandidates(forecast.points, config, forecast.today, ruleId);
}

/** Gastos del usuario desde una fecha, sin traspasos ni partes de un gasto dividido. */
async function expensesSince(userId: number, from: string): Promise<ChargeRow[]> {
  return db
    .select({
      id: transactions.id, date: transactions.date, amount: transactions.amount, payee: transactions.payee,
      accountId: transactions.accountId, recurringTransactionId: transactions.recurringTransactionId,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), gte(transactions.date, from), isNull(transactions.splitGroupId)));
}

export async function evalSubscriptionPriceIncrease(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.subscription_price_increase>,
): Promise<FinanceAlertCandidate[]> {
  const today = getTodayIsoDate();
  return priceIncreaseCandidates(await expensesSince(userId, addDaysIso(today, -240)), config, today, ruleId);
}

export async function evalDuplicateCharge(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.duplicate_charge>,
): Promise<FinanceAlertCandidate[]> {
  const today = getTodayIsoDate();
  // Solo cargos de los últimos 10 días: lo antiguo ya no se puede reclamar con prisa.
  const rows = (await expensesSince(userId, addDaysIso(today, -10)))
    // Las ocurrencias de una recurrente (y lo programado a futuro) no son duplicados aunque coincidan.
    .filter((r) => r.date <= today && r.recurringTransactionId == null);
  return duplicateChargeCandidates(rows, config, ruleId);
}

export async function evalUnusualCategorySpend(
  userId: number,
  ruleId: number,
  config: z.infer<typeof financeAlertConfigSchemas.unusual_category_spend>,
): Promise<FinanceAlertCandidate[]> {
  const month = getTodayIsoDate().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = `${new Date(Date.UTC(y, m - 7, 1)).toISOString().slice(0, 7)}-01`;
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      spent: sql<number>`sum(${transactions.amount})::float8`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), gte(transactions.date, from)))
    .groupBy(transactions.categoryId, categories.name, sql`to_char(${transactions.date}, 'YYYY-MM')`);
  return unusualSpendCandidates(rows.map((r) => ({ ...r, categoryId: r.categoryId! })), config, month, ruleId);
}
