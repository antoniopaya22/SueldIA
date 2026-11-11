import { expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("ocurrencias saltadas de una recurrente (integración)", () => {
  it("una ocurrencia saltada no vuelve a generarse ni cuenta en la previsión", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { and, eq } = await import("drizzle-orm");
    const { syncRecurringTransactions, getTodayIsoDate } = await import("./recurring-transactions.service.js");
    const { getForecast } = await import("./forecast.service.js");
    await resetDb();
    const userId = await createUser("skips");
    const today = getTodayIsoDate();
    const [acc] = await db.insert(s.accounts).values({ userId, name: "Banco", initialBalance: 1000 }).returning();
    // Semanal empezando hoy: hay ocurrencias dentro del margen de sincronización (30 días).
    const [rule] = await db.insert(s.recurringTransactions).values({
      userId, accountId: acc.id, type: "expense", amount: 10, cadence: "weekly", intervalCount: 1, startDate: today, payee: "Gimnasio",
    }).returning();
    await syncRecurringTransactions(userId);
    const occurrences = () => db.select().from(s.transactions).where(eq(s.transactions.recurringTransactionId, rule.id));
    const before = await occurrences();
    expect(before.length).toBeGreaterThanOrEqual(4);
    const target = before.find((t) => t.scheduledFor! > today)!;

    await db.insert(s.recurringSkips).values({ recurringTransactionId: rule.id, scheduledFor: target.scheduledFor! });
    await db.delete(s.transactions).where(and(eq(s.transactions.id, target.id)));
    await syncRecurringTransactions(userId);
    const after = await occurrences();
    expect(after.map((t) => t.scheduledFor)).not.toContain(target.scheduledFor);
    expect(after).toHaveLength(before.length - 1);

    // Tampoco aparece en la previsión de los próximos meses.
    const forecast = await getForecast(userId, 90);
    expect(forecast.upcoming.some((i) => i.date === target.scheduledFor && i.payee === "Gimnasio")).toBe(false);
  });
});
