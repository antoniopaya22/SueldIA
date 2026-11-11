import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { savingsGoals } from "../db/schema.js";
import { getAccountsWithBalance } from "./finance.service.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";

export interface GoalProgress {
  /** Lo ahorrado: el saldo de la cuenta asociada o lo apuntado a mano. */
  saved: number;
  remaining: number;
  /** 0–100 (puede pasar de 100 si se ha superado). */
  percent: number;
  /** Meses que quedan hasta la fecha (contando el actual), o null sin fecha. */
  monthsLeft: number | null;
  /** Lo que habría que apartar cada mes para llegar a tiempo, o null. */
  monthlyNeeded: number | null;
  status: "done" | "on-track" | "no-date" | "overdue";
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/** Progreso de un objetivo (puro, probado). */
export function goalProgress(goal: { targetAmount: number; targetDate: string | null }, saved: number, today: string): GoalProgress {
  const remaining = roundCents(Math.max(0, goal.targetAmount - saved));
  const percent = goal.targetAmount > 0 ? Math.round((saved / goal.targetAmount) * 1000) / 10 : 0;
  if (remaining === 0) return { saved: roundCents(saved), remaining, percent, monthsLeft: null, monthlyNeeded: null, status: "done" };
  if (!goal.targetDate) return { saved: roundCents(saved), remaining, percent, monthsLeft: null, monthlyNeeded: null, status: "no-date" };
  const [ty, tm] = goal.targetDate.split("-").map(Number);
  const [y, m] = today.split("-").map(Number);
  const monthsLeft = (ty - y) * 12 + (tm - m) + 1;
  if (goal.targetDate < today || monthsLeft <= 0) {
    return { saved: roundCents(saved), remaining, percent, monthsLeft: 0, monthlyNeeded: null, status: "overdue" };
  }
  return { saved: roundCents(saved), remaining, percent, monthsLeft, monthlyNeeded: roundCents(remaining / monthsLeft), status: "on-track" };
}

export async function listGoals(userId: number) {
  const [goals, balances] = await Promise.all([
    db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(asc(savingsGoals.archived), asc(savingsGoals.targetDate), asc(savingsGoals.id)),
    getAccountsWithBalance(userId),
  ]);
  const balanceById = new Map(balances.map((a) => [a.id, { balance: a.balance, name: a.name }]));
  const today = getTodayIsoDate();
  return goals.map((g) => {
    const account = g.accountId ? balanceById.get(g.accountId) : undefined;
    // Con cuenta asociada, lo ahorrado es su saldo (nunca negativo para el progreso).
    const saved = account ? Math.max(0, account.balance) : g.savedAmount;
    return { ...g, accountName: account?.name ?? null, progress: goalProgress(g, saved, today) };
  });
}

export async function goalBelongsToUser(userId: number, id: number): Promise<boolean> {
  const [row] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
  return Boolean(row);
}
