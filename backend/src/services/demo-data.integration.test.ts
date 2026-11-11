import { describe, expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";
import { demoPayslip, lastMonths } from "./demo-data.service.js";

describe("datos de ejemplo: piezas puras", () => {
  it("los últimos 12 meses completos, en orden", () => {
    expect(lastMonths("2026-03-15", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(lastMonths("2026-01-02", 12)[11]).toBe("2025-12");
  });
  it("una nómina cuadra: neto = bruto − deducciones", () => {
    const p = demoPayslip("2026-02");
    expect(p.gross).toBe(2410);
    expect(Math.round((p.gross - p.deducciones.reduce((s, c) => s + c.amount, 0)) * 100) / 100).toBe(p.net);
    expect(demoPayslip("2026-08").gross).toBeGreaterThan(p.gross); // subida a mitad de año
  });
});

describeDb("datos de ejemplo (integración)", () => {
  it("se cargan una vez y se quitan sin tocar lo del usuario", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const { createDemoData, deleteDemoData, getDemoRecord } = await import("./demo-data.service.js");
    await resetDb();
    const userId = await createUser("demo");
    const [own] = await db.insert(s.accounts).values({ userId, name: "Mía" }).returning();
    await db.insert(s.transactions).values({ userId, accountId: own.id, type: "expense", amount: 5, date: "2026-01-01", payee: "Mío" });

    const record = await createDemoData(userId);
    expect(await getDemoRecord(userId)).toMatchObject({ profileId: record.profileId });
    const payslips = await db.select().from(s.payslips).where(eq(s.payslips.profileId, record.profileId));
    expect(payslips.length).toBe(14); // 12 mensuales + 2 extras
    const demoTx = await db.select().from(s.transactions).where(eq(s.transactions.importBatchId, record.batchId));
    expect(demoTx.filter((t) => t.payslipId != null)).toHaveLength(14); // cada nómina con su ingreso
    await expect(createDemoData(userId)).rejects.toThrow(/Ya tienes/);

    expect(await deleteDemoData(userId)).toBe(true);
    expect(await db.select().from(s.payslips)).toHaveLength(0);
    expect((await db.select().from(s.transactions)).map((t) => t.payee)).toEqual(["Mío"]);
    expect((await db.select().from(s.accounts)).map((a) => a.name)).toEqual(["Mía"]);
    expect(await db.select().from(s.categoryGroups)).toHaveLength(0);
    expect(await getDemoRecord(userId)).toBeNull();
  });
});
