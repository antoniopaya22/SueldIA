import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, transactions } from "../db/schema.js";
import { effectiveTransaction } from "./transaction-filters.js";
import { getValuationAdjustments, signedAmountSql } from "./finance.service.js";
import { adjustmentAt } from "./loans.service.js";
import { todayIso } from "../utils/dates.js";

// Conciliar una cuenta: comprobar que el saldo liquidado de SueldIA coincide
// con el que dice el banco. Si coincide (o se acepta crear un ajuste por la
// diferencia), los movimientos liquidados quedan marcados como conciliados y
// la cuenta guarda fecha y saldo de la conciliación. Sin esto no había forma
// de saber si los saldos —y con ellos presupuesto y previsión— eran fiables.

export type ReconcileResult =
  | { ok: true; difference: number; adjustmentId: number | null; reconciledCount: number }
  | { ok: false; difference: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Saldo liquidado (saldo inicial + movimientos liquidados) de una cuenta del usuario; null si no es suya. */
export async function clearedBalance(userId: number, accountId: number): Promise<number | null> {
  const [account] = await db
    .select({ initialBalance: accounts.initialBalance })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!account) return null;
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${signedAmountSql}) filter (where ${effectiveTransaction()}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)));
  // Con valoraciones (inversiones), el saldo parte de la última: igual que en Cuentas.
  const valuation = adjustmentAt((await getValuationAdjustments(userId)).get(accountId), todayIso());
  return round2(account.initialBalance + Number(row?.total ?? 0) + valuation);
}

export async function reconcileAccount(
  userId: number,
  accountId: number,
  statementBalance: number,
  createAdjustment: boolean,
): Promise<ReconcileResult | null> {
  const cleared = await clearedBalance(userId, accountId);
  if (cleared === null) return null;
  const difference = round2(statementBalance - cleared);
  if (difference !== 0 && !createAdjustment) return { ok: false, difference };

  return db.transaction(async (tx) => {
    let adjustmentId: number | null = null;
    if (difference !== 0) {
      const [adj] = await tx
        .insert(transactions)
        .values({
          userId,
          accountId,
          type: difference > 0 ? "income" : "expense",
          amount: Math.abs(difference),
          date: todayIso(),
          payee: "Ajuste de conciliación",
          memo: `Diferencia con el saldo del banco (${statementBalance.toFixed(2)} €)`,
          cleared: true,
          reconciled: true,
        })
        .returning({ id: transactions.id });
      adjustmentId = adj.id;
    }
    const reconciled = await tx
      .update(transactions)
      .set({ reconciled: true })
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        eq(transactions.cleared, true),
        eq(transactions.reconciled, false),
      ))
      .returning({ id: transactions.id });
    await tx
      .update(accounts)
      .set({ lastReconciledAt: new Date(), lastReconciledBalance: statementBalance })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    return { ok: true as const, difference, adjustmentId, reconciledCount: reconciled.length };
  });
}
