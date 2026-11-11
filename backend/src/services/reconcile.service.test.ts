import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createUser, describeDb, resetDb } from "../test/db.js";

describeDb("conciliación (integración)", () => {
  let db: typeof import("../db/index.js").db;
  let s: typeof import("../db/schema.js");
  let svc: typeof import("./reconcile.service.js");
  let userId: number;
  let accountId: number;

  beforeEach(async () => {
    ({ db } = await import("../db/index.js"));
    s = await import("../db/schema.js");
    svc = await import("./reconcile.service.js");
    await resetDb();
    userId = await createUser("rec");
    [{ id: accountId }] = await db.insert(s.accounts).values({ userId, name: "Banco", initialBalance: 1000 }).returning();
    await db.insert(s.transactions).values([
      { userId, accountId, type: "income", amount: 500, date: "2026-01-02", cleared: true },
      { userId, accountId, type: "expense", amount: 120.5, date: "2026-01-03", cleared: true },
      { userId, accountId, type: "expense", amount: 40, date: "2026-01-04", cleared: false },
    ]);
  });

  it("saldo liquidado ignora los pendientes", async () => {
    expect(await svc.clearedBalance(userId, accountId)).toBe(1379.5);
  });

  it("si cuadra, marca los liquidados como conciliados", async () => {
    const r = await svc.reconcileAccount(userId, accountId, 1379.5, false);
    expect(r).toMatchObject({ ok: true, difference: 0, adjustmentId: null, reconciledCount: 2 });
    const rows = await db.select().from(s.transactions).where(eq(s.transactions.accountId, accountId));
    expect(rows.filter((t) => t.reconciled)).toHaveLength(2);
    const [acc] = await db.select().from(s.accounts).where(eq(s.accounts.id, accountId));
    expect(acc.lastReconciledBalance).toBe(1379.5);
    expect(acc.lastReconciledAt).not.toBeNull();
  });

  it("si no cuadra, no toca nada salvo que se pida el ajuste", async () => {
    expect(await svc.reconcileAccount(userId, accountId, 1370, false)).toEqual({ ok: false, difference: -9.5 });
    const r = await svc.reconcileAccount(userId, accountId, 1370, true);
    expect(r).toMatchObject({ ok: true, difference: -9.5 });
    expect(await svc.clearedBalance(userId, accountId)).toBe(1370);
  });

  it("no concilia cuentas ajenas", async () => {
    const other = await createUser("otro");
    expect(await svc.reconcileAccount(other, accountId, 0, true)).toBeNull();
  });
});
