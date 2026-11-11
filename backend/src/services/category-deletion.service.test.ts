import { beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("deleteCategories (integración)", () => {
  let db: typeof import("../db/index.js").db;
  let s: typeof import("../db/schema.js");
  let svc: typeof import("./category-deletion.service.js");
  let userId: number;
  let accountId: number;
  let groupId: number;
  let catA: number;
  let catB: number;

  beforeEach(async () => {
    ({ db } = await import("../db/index.js"));
    s = await import("../db/schema.js");
    svc = await import("./category-deletion.service.js");
    await resetDb();
    userId = await createUser("u1");
    [{ id: accountId }] = await db.insert(s.accounts).values({ userId, name: "Banco" }).returning();
    [{ id: groupId }] = await db.insert(s.categoryGroups).values({ userId, name: "Hogar" }).returning();
    [{ id: catA }, { id: catB }] = await db
      .insert(s.categories)
      .values([{ groupId, name: "Super" }, { groupId, name: "Comida" }])
      .returning();
    await db.insert(s.transactions).values([
      { userId, accountId, categoryId: catA, type: "expense", amount: 10, date: "2026-01-05" },
      { userId, accountId, categoryId: catA, type: "expense", amount: 20, date: "2026-02-05" },
    ]);
    await db.insert(s.budgets).values([
      { userId, categoryId: catA, month: "2026-01", assigned: 100 },
      { userId, categoryId: catA, month: "2026-02", assigned: 50 },
      { userId, categoryId: catB, month: "2026-01", assigned: 30 },
    ]);
    await db.insert(s.categoryRules).values({ userId, match: "mercadona", categoryId: catA });
  });

  it("calcula el alcance", async () => {
    expect(await svc.getCategoryUsage(userId, [catA])).toEqual({
      transactions: 2, recurring: 0, budgetMonths: 2, rules: 1, targets: 0,
    });
  });

  it("reasigna movimientos, reglas y suma el presupuesto en la categoría destino", async () => {
    await svc.deleteCategories(userId, [catA], catB);

    const txs = await db.select().from(s.transactions).where(eq(s.transactions.userId, userId));
    expect(txs.every((t) => t.categoryId === catB)).toBe(true);
    const [rule] = await db.select().from(s.categoryRules);
    expect(rule.categoryId).toBe(catB);
    const bud = await db.select().from(s.budgets).where(eq(s.budgets.categoryId, catB));
    const byMonth = Object.fromEntries(bud.map((b) => [b.month, b.assigned]));
    expect(byMonth).toEqual({ "2026-01": 130, "2026-02": 50 });
    expect(await db.select().from(s.categories).where(eq(s.categories.id, catA))).toHaveLength(0);
  });

  it("sin destino, los movimientos quedan sin categoría", async () => {
    await svc.deleteCategories(userId, [catA], null);
    const txs = await db.select().from(s.transactions);
    expect(txs.every((t) => t.categoryId === null)).toBe(true);
  });

  it("borra un grupo entero reasignando a una categoría de otro grupo", async () => {
    const [{ id: otherGroup }] = await db.insert(s.categoryGroups).values({ userId, name: "Otros" }).returning();
    const [{ id: catC }] = await db.insert(s.categories).values({ groupId: otherGroup, name: "Varios" }).returning();
    const ids = (await svc.ownedGroupCategoryIds(userId, groupId))!;
    await svc.deleteCategories(userId, ids, catC, groupId);

    expect(await db.select().from(s.categoryGroups).where(eq(s.categoryGroups.id, groupId))).toHaveLength(0);
    const txs = await db.select().from(s.transactions);
    expect(txs.every((t) => t.categoryId === catC)).toBe(true);
    const [jan] = await db.select().from(s.budgets).where(and(eq(s.budgets.categoryId, catC), eq(s.budgets.month, "2026-01")));
    expect(jan.assigned).toBe(130);
  });

  it("no ve categorías de otro usuario", async () => {
    const other = await createUser("u2");
    expect(await svc.ownedCategoryGroupId(other, catA)).toBeNull();
    expect(await svc.ownedGroupCategoryIds(other, groupId)).toBeNull();
  });
});
