import { expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("traspasos recurrentes (integración)", () => {
  it("generan las dos patas enlazadas, mueven el saldo y se borran juntas", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { eq, inArray } = await import("drizzle-orm");
    const { syncRecurringTransactions, getTodayIsoDate, deletePendingRecurringOccurrences } = await import("./recurring-transactions.service.js");
    const { getAccountsWithBalance } = await import("./finance.service.js");
    await resetDb();
    const userId = await createUser("rec-transfer");
    const today = getTodayIsoDate();
    const [bank, savings] = await db.insert(s.accounts).values([
      { userId, name: "Banco", initialBalance: 1000 },
      { userId, name: "Ahorro", initialBalance: 0 },
    ]).returning();
    const [rule] = await db.insert(s.recurringTransactions).values({
      userId, accountId: bank.id, targetAccountId: savings.id, type: "transfer", amount: 100, cadence: "monthly",
      intervalCount: 1, startDate: today, autoSettle: true,
    }).returning();

    await syncRecurringTransactions(userId);
    const outs = await db.select().from(s.transactions).where(eq(s.transactions.recurringTransactionId, rule.id));
    // La de hoy y, según el mes, la siguiente (el margen de sincronización es de 30 días).
    expect(outs.length).toBeGreaterThanOrEqual(1);
    const out = outs.find((t) => t.scheduledFor === today)!;
    expect(out).toMatchObject({ type: "transfer", accountId: bank.id, payee: "Traspaso a Ahorro", cleared: true });
    const [inn] = await db.select().from(s.transactions).where(eq(s.transactions.id, out.transferId!));
    expect(inn).toMatchObject({ type: "transfer", accountId: savings.id, transferId: out.id, cleared: true });
    expect(inn.id).toBeGreaterThan(out.id);

    // La futura queda pendiente; la de hoy se liquida sola (domiciliación): 100 € pasan del banco al ahorro.
    const balances = new Map((await getAccountsWithBalance(userId)).map((a) => [a.name, a.balance]));
    expect(balances.get("Banco")).toBe(900);
    expect(balances.get("Ahorro")).toBe(100);

    // Sincronizar otra vez no duplica: dos patas por ocurrencia.
    await syncRecurringTransactions(userId);
    expect(await db.select().from(s.transactions)).toHaveLength(outs.length * 2);

    // Las pendientes se borran con su pareja.
    await db.update(s.transactions).set({ cleared: false }).where(inArray(s.transactions.id, [out.id, inn.id]));
    await deletePendingRecurringOccurrences(userId, rule.id);
    expect(await db.select().from(s.transactions)).toHaveLength(0);
  });
});
