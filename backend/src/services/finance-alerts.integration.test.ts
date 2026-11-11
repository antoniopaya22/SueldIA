import { expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("reglas de finanzas nuevas (integración)", () => {
  it("se evalúan contra la base de datos y no repiten avisos", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { evaluateRulesForUser } = await import("./alerts.service.js");
    const { getTodayIsoDate } = await import("./recurring-transactions.service.js");
    await resetDb();
    const userId = await createUser("finance-rules");
    const today = getTodayIsoDate();
    const day = (offset: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const [acc] = await db.insert(s.accounts).values({ userId, name: "Banco", initialBalance: 100 }).returning();
    const [grp] = await db.insert(s.categoryGroups).values({ userId, name: "Casa" }).returning();
    const [cat] = await db.insert(s.categories).values({ groupId: grp.id, name: "Ocio" }).returning();
    await db.insert(s.transactions).values([
      // Cargo duplicado hoy y ayer.
      { userId, accountId: acc.id, type: "expense", amount: 49.9, date: day(-1), payee: "Amazon", cleared: true },
      { userId, accountId: acc.id, type: "expense", amount: 49.9, date: today, payee: "Amazon", cleared: true },
      // Un gasto pendiente que hará bajar el saldo previsto de 0.
      { userId, accountId: acc.id, type: "expense", amount: 500, date: day(3), payee: "Alquiler", cleared: false, categoryId: cat.id },
    ]);
    await db.insert(s.alertRules).values([
      { userId, name: "Duplicados", type: "duplicate_charge", config: "{}" },
      { userId, name: "Saldo previsto", type: "low_balance_forecast", config: JSON.stringify({ threshold: 0, days: 14 }) },
      { userId, name: "Suscripciones", type: "subscription_price_increase", config: "{}" },
      { userId, name: "Gasto inusual", type: "unusual_category_spend", config: "{}" },
    ]);

    const created = await evaluateRulesForUser(userId);
    const history = await db.select().from(s.alertHistory);
    expect(history.map((h) => h.type).sort()).toEqual(["duplicate_charge", "low_balance_forecast"]);
    expect(created).toBe(2);
    // Volver a evaluar (cron diario) no duplica.
    expect(await evaluateRulesForUser(userId)).toBe(0);
  });
});
