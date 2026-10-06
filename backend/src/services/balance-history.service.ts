import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, transactions } from "../db/schema.js";
import { shiftMonthKey } from "./budgets.service.js";
import { signedAmountSql } from "./finance.service.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";
import { effectiveTransaction } from "./transaction-filters.js";

/* ───────── Saldo histórico ──────────────────────────────────────
 * Saldo al final de cada mes, por cuenta y en total. Hoy el dashboard lo
 * reconstruye hacia atrás desde el saldo actual y solo con lo liquidado del
 * rango filtrado; aquí se calcula hacia delante desde el saldo inicial de cada
 * cuenta, así que es exacto y no depende del filtro.
 */

export interface HistoryAccount {
  id: number;
  name: string;
  color: string;
  type: string;
  archived: boolean;
  initialBalance: number;
}

export interface MonthlyNet {
  accountId: number;
  month: string;
  net: number;
}

export interface BalanceHistory {
  months: string[];
  accounts: { id: number; name: string; color: string; type: string; archived: boolean; series: number[] }[];
  /** Suma de las cuentas no archivadas. */
  total: number[];
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/** `count` meses consecutivos terminando en `endMonth`, del más antiguo al más reciente. */
export function monthKeys(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonthKey(endMonth, i - (count - 1)));
}

/**
 * `nets` = movimiento neto de cada cuenta en cada mes (todo el histórico).
 * Lo anterior a la ventana cuenta como saldo de partida; lo posterior (p. ej.
 * un movimiento liquidado con fecha futura) se suma al último mes, para que el
 * último punto coincida con el saldo actual.
 */
export function buildBalanceHistory(historyAccounts: HistoryAccount[], nets: MonthlyNet[], months: string[]): BalanceHistory {
  const last = months.length - 1;
  const result = historyAccounts.map((a) => {
    const deltas = new Array<number>(months.length).fill(0);
    let before = 0;
    for (const n of nets) {
      if (n.accountId !== a.id) continue;
      if (n.month < months[0]) before += n.net;
      else if (n.month > months[last]) deltas[last] += n.net;
      else deltas[months.indexOf(n.month)] += n.net;
    }
    let running = a.initialBalance + before;
    const series = deltas.map((d) => roundCents((running += d)));
    return { id: a.id, name: a.name, color: a.color, type: a.type, archived: a.archived, series };
  });
  const total = months.map((_, i) => roundCents(result.filter((a) => !a.archived).reduce((s, a) => s + a.series[i], 0)));
  return { months, accounts: result, total };
}

export async function getBalanceHistory(userId: number, count = 12): Promise<BalanceHistory> {
  const months = monthKeys(getTodayIsoDate().slice(0, 7), count);
  const [accountRows, netRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.name),
    db
      .select({
        accountId: transactions.accountId,
        month: sql<string>`substr(${transactions.date}, 1, 7)`,
        net: sql<number>`sum(${signedAmountSql})`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), effectiveTransaction()))
      .groupBy(transactions.accountId, sql`substr(${transactions.date}, 1, 7)`),
  ]);
  return buildBalanceHistory(
    accountRows.map((a) => ({
      id: a.id, name: a.name, color: a.color, type: a.type, archived: a.archived, initialBalance: a.initialBalance,
    })),
    netRows.map((r) => ({ accountId: r.accountId, month: r.month, net: Number(r.net) })),
    months,
  );
}
