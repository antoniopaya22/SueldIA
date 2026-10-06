import { z } from "zod";
import { and, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";
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
      if (limit <= 0 || over < 0.01) continue;
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
    // Una tarjeta de crédito en negativo es lo normal: solo se vigila si se elige a propósito.
    .filter((a) => (config.accountId ? a.id === config.accountId : a.type !== "credit_card"))
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
