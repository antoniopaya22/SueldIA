import { expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("getBudgetSummary (integración)", () => {
  it("incluye saldos iniciales, lo asignado y el gasto sin categoría", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { getBudgetSummary } = await import("./budgets.service.js");
    await resetDb();
    const userId = await createUser("budget");
    const [acc] = await db.insert(s.accounts).values({ userId, name: "Banco", initialBalance: 5000 }).returning();
    const [grp] = await db.insert(s.categoryGroups).values({ userId, name: "Casa" }).returning();
    const [cat] = await db.insert(s.categories).values({ groupId: grp.id, name: "Super" }).returning();
    const month = new Date().toISOString().slice(0, 7);
    await db.insert(s.transactions).values([
      { userId, accountId: acc.id, type: "income", amount: 2000, date: `${month}-01`, cleared: true },
      { userId, accountId: acc.id, type: "expense", amount: 40, date: `${month}-02`, cleared: true, categoryId: cat.id },
      { userId, accountId: acc.id, type: "expense", amount: 25, date: `${month}-02`, cleared: true },
    ]);
    await db.insert(s.budgets).values({ userId, categoryId: cat.id, month, assigned: 300 });

    const summary = await getBudgetSummary(userId, month);
    expect(summary.readyBreakdown).toEqual({ income: 2000, initialBalances: 5000, assigned: 300 });
    expect(summary.readyToAssign).toBe(6700);
    expect(summary.uncategorizedActivity).toBe(-25);
  });
});

