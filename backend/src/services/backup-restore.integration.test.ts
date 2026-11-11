import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createUser, describeDb, resetDb } from "../test/db.js";
import { readBackupFile, remapDedupeKey } from "./backup-restore.service.js";

const minimal = { format: "sueldia-backup", version: 1, profiles: [] };
const file = (data: unknown, gzip = false) => {
  const buf = Buffer.from(JSON.stringify(data));
  return gzip ? gzipSync(buf) : buf;
};

describe("readBackupFile", () => {
  it("lee JSON plano o comprimido con gzip", () => {
    expect(readBackupFile(file(minimal)).profiles).toEqual([]);
    expect(readBackupFile(file(minimal, true)).transactions).toEqual([]);
  });
  it("rechaza lo que no es una copia, con un mensaje claro", () => {
    expect(() => readBackupFile(Buffer.from("hola"))).toThrow(/no es JSON válido/);
    expect(() => readBackupFile(file({ foo: 1 }))).toThrow(/no es una copia de SueldIA/);
    expect(() => readBackupFile(file({ ...minimal, version: 99 }))).toThrow(/versión más nueva/);
  });
  it("rechaza referencias rotas antes de tocar nada", () => {
    const acc = { id: 1, name: "Banco", type: "bank", initialBalance: 0, color: "#000", archived: false };
    const tx = (id: number, transferId: number | null) => ({
      id, accountId: 1, categoryId: null, type: "transfer", amount: 10, date: "2026-01-01", cleared: true, transferId,
    });
    expect(() => readBackupFile(file({ ...minimal, accounts: [acc], transactions: [tx(1, 2)] }))).toThrow(/traspaso sin su otra mitad/);
    expect(() => readBackupFile(file({ ...minimal, transactions: [tx(1, null)] }))).toThrow(/movimientos sin su cuenta/);
    expect(() => readBackupFile(file({ ...minimal, accounts: [acc], transactions: [{ ...tx(1, null), date: "2026-02-30" }] }))).toThrow(
      /transactions\.0\.date/,
    );
  });
});

describe("remapDedupeKey", () => {
  const m = (pairs: Array<[number, number]>) => new Map(pairs);
  const maps = {
    rules: m([[1, 11]]), payslips: m([[5, 55]]), profiles: m([[2, 22]]), categories: m([[3, 33]]), accounts: m([[4, 44]]),
  };
  it.each([
    ["missing:2:2026-3", "missing:22:2026-3"],
    ["salary_drop:1:5", "salary_drop:11:55"],
    ["irpf_change:1:5", "irpf_change:11:55"],
    ["overspent:1:3:2026-03", "overspent:11:33:2026-03"],
    ["low_balance:1:4:2026-03", "low_balance:11:44:2026-03"],
    ["overdue:1:2026-W10", "overdue:11:2026-W10"],
    ["otra:1:5", "otra:1:5"],
  ])("%s → %s", (from, to) => {
    expect(remapDedupeKey(from, maps)).toBe(to);
  });
});

describeDb("copia de seguridad (integración)", () => {
  it("exportar y restaurar en otra cuenta conserva datos y referencias", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const { buildFullExport, restoreBackup, countCurrent } = await import("./backup-restore.service.js");
    await resetDb();

    // ── Cuenta A con un poco de todo ──
    const a = await createUser("backup-a");
    const [profile] = await db.insert(s.profiles).values({ userId: a, name: "Ana", color: "#123456" }).returning();
    const [payslip] = await db.insert(s.payslips).values({
      profileId: profile.id, fileName: "marzo.pdf", periodMonth: 3, periodYear: 2026, netSalary: 2000, grossSalary: 2600,
      parsingStatus: "parsed", rawText: "SALARIO BASE 2.600,00", contentHash: "abc",
    }).returning();
    await db.insert(s.payslipConcepts).values({ payslipId: payslip.id, category: "deduccion", name: "IRPF", amount: 400, kind: "irpf" });
    await db.insert(s.payslipNotes).values({ payslipId: payslip.id, content: "Revisada" });
    const [tag] = await db.insert(s.tags).values({ userId: a, name: "2026" }).returning();
    await db.insert(s.payslipTags).values({ payslipId: payslip.id, tagId: tag.id });
    const [bank, savings] = await db.insert(s.accounts).values([
      { userId: a, name: "Banco", initialBalance: 1000 },
      { userId: a, name: "Ahorro", type: "investment", initialBalance: 0 },
      { userId: a, name: "Hipoteca", type: "mortgage", initialBalance: -90000, loanPrincipal: 100000, loanRate: 3, loanTermMonths: 300, loanStartDate: "2020-01-05" },
    ]).returning();
    await db.insert(s.accountValuations).values({ userId: a, accountId: savings.id, date: "2026-03-31", value: 320 });
    const [group] = await db.insert(s.categoryGroups).values({ userId: a, name: "Casa" }).returning();
    const [cat] = await db.insert(s.categories).values({ groupId: group.id, name: "Super" }).returning();
    const [rec] = await db.insert(s.recurringTransactions).values({
      userId: a, accountId: bank.id, categoryId: cat.id, type: "expense", amount: 9.99, startDate: "2026-01-01", payee: "Netflix",
    }).returning();
    const [salary] = await db.insert(s.transactions).values({
      userId: a, accountId: bank.id, type: "income", amount: 2000, date: "2026-03-28", cleared: true, payslipId: payslip.id, payee: "ACME",
    }).returning();
    await db.insert(s.transactions).values({
      userId: a, accountId: bank.id, categoryId: cat.id, type: "expense", amount: 9.99, date: "2026-03-01", recurringTransactionId: rec.id,
    });
    const [out] = await db.insert(s.transactions).values({ userId: a, accountId: bank.id, type: "transfer", amount: -300, date: "2026-03-30", cleared: true }).returning();
    const [inn] = await db.insert(s.transactions).values({
      userId: a, accountId: savings.id, type: "transfer", amount: 300, date: "2026-03-30", cleared: true, transferId: out.id,
    }).returning();
    await db.update(s.transactions).set({ transferId: inn.id }).where(eq(s.transactions.id, out.id));
    await db.insert(s.budgets).values({ userId: a, categoryId: cat.id, month: "2026-03", assigned: 250 });
    await db.insert(s.categoryTargets).values({ userId: a, categoryId: cat.id, type: "monthly", amount: 250 });
    await db.insert(s.categoryRules).values({ userId: a, match: "mercadona", categoryId: cat.id, accountId: bank.id });
    const [rule] = await db.insert(s.alertRules).values({
      userId: a, name: "Bajada", type: "salary_drop", config: JSON.stringify({ profileId: profile.id, thresholdPercent: 10 }),
    }).returning();
    await db.insert(s.alertHistory).values({
      userId: a, ruleId: rule.id, payslipId: payslip.id, type: "salary_drop", severity: "warning", message: "Bajó",
      dedupeKey: `salary_drop:${rule.id}:${payslip.id}`,
    });
    await db.insert(s.userPreferences).values({ userId: a, key: "chart-palette", value: JSON.stringify("ocean") });

    // ── Cuenta B con datos propios que la copia debe sustituir ──
    const b = await createUser("backup-b");
    await db.insert(s.profiles).values({ userId: b, name: "Viejo" });
    await db.insert(s.accounts).values({ userId: b, name: "Cuenta vieja" });

    const exported = await buildFullExport(a);
    const backup = readBackupFile(gzipSync(Buffer.from(JSON.stringify(exported))));
    const restored = await restoreBackup(b, backup);
    expect(restored).toEqual(await countCurrent(a));
    expect(await countCurrent(b)).toEqual(await countCurrent(a));

    const after = (await buildFullExport(b))!;
    expect(after.profiles.map((p) => p.name)).toEqual(["Ana"]);
    expect(after.accounts.map((x) => x.name).sort()).toEqual(["Ahorro", "Banco", "Hipoteca"]);
    expect(after.accounts.find((x) => x.name === "Hipoteca")).toMatchObject({ type: "mortgage", loanPrincipal: 100000, loanRate: 3, loanTermMonths: 300, loanStartDate: "2020-01-05" });
    const newSavings = after.accounts.find((x) => x.name === "Ahorro")!;
    expect(after.accountValuations).toEqual([{ accountId: newSavings.id, date: "2026-03-31", value: 320 }]);
    const newProfile = after.profiles[0];
    const newPayslip = after.payslips[0];
    expect(newPayslip).toMatchObject({ profileId: newProfile.id, fileName: "marzo.pdf", rawText: "SALARIO BASE 2.600,00", contentHash: "abc" });
    expect(newPayslip.id).not.toBe(payslip.id);
    expect(after.payslipConcepts).toMatchObject([{ payslipId: newPayslip.id, name: "IRPF", kind: "irpf" }]);
    expect(after.payslipNotes).toMatchObject([{ payslipId: newPayslip.id, content: "Revisada" }]);
    expect(after.payslipTags).toMatchObject([{ payslipId: newPayslip.id, tagId: after.tags[0].id }]);

    // Referencias entre movimientos: traspaso, nómina, recurrente, categoría.
    const txs = after.transactions;
    const [t1, t2] = txs.filter((t) => t.type === "transfer");
    expect(t1.transferId).toBe(t2.id);
    expect(t2.transferId).toBe(t1.id);
    expect(t1.accountId).not.toBe(t2.accountId);
    expect(txs.find((t) => t.payee === "ACME")).toMatchObject({ payslipId: newPayslip.id, amount: salary.amount });
    const newCat = after.categories[0];
    expect(txs.find((t) => t.recurringTransactionId != null)).toMatchObject({
      recurringTransactionId: after.recurringTransactions[0].id, categoryId: newCat.id,
    });
    const newBank = after.accounts.find((x) => x.name === "Banco")!;
    expect(after.categoryRules).toMatchObject([{ match: "mercadona", categoryId: newCat.id, accountId: newBank.id }]);
    expect(after.budgets).toMatchObject([{ categoryId: newCat.id, month: "2026-03", assigned: 250 }]);

    // Alertas: config y clave de deduplicación con los ids nuevos.
    const newRule = after.alertRules[0];
    expect(newRule.config).toEqual({ profileId: newProfile.id, thresholdPercent: 10 });
    expect(after.alertHistory).toMatchObject([{ ruleId: newRule.id, payslipId: newPayslip.id, dedupeKey: `salary_drop:${newRule.id}:${newPayslip.id}` }]);
    expect(after.userPreferences).toMatchObject([{ key: "chart-palette", value: "ocean" }]);

    // A sigue intacta.
    expect((await buildFullExport(a))!.transactions).toHaveLength(4);
  });

  it("si la copia falla a medias, no se cambia nada", async () => {
    const { db } = await import("../db/index.js");
    const s = await import("../db/schema.js");
    const { restoreBackup, countCurrent } = await import("./backup-restore.service.js");
    await resetDb();
    const b = await createUser("backup-fail");
    await db.insert(s.accounts).values({ userId: b, name: "Mía" });
    const before = await countCurrent(b);

    // Dos presupuestos para la misma categoría y mes: pasa la validación,
    // choca con el índice único al insertar.
    const backup = readBackupFile(file({
      ...minimal,
      categoryGroups: [{ id: 1, name: "G", sortOrder: 0 }],
      categories: [{ id: 1, groupId: 1, name: "C", sortOrder: 0 }],
      budgets: [{ categoryId: 1, month: "2026-01", assigned: 1 }, { categoryId: 1, month: "2026-01", assigned: 2 }],
    }));
    await expect(restoreBackup(b, backup)).rejects.toThrow(/repetidos o incoherentes/);
    expect(await countCurrent(b)).toEqual(before);
  });
});
