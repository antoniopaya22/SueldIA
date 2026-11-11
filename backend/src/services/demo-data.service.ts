import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import * as s from "../db/schema.js";
import { classifyConcept } from "../parsers/concept-classifier.js";
import { AppError } from "../middleware/error-handler.js";
import { deletePreference, listPreferences, setPreference } from "./preferences.service.js";
import { getTodayIsoDate } from "./recurring-transactions.service.js";

// Datos de ejemplo para explorar la app sin subir nada: un año de nóminas de
// una persona ficticia, una cuenta con sus movimientos, categorías y un
// presupuesto. Todo lo creado se apunta en la preferencia «demo-data» para
// poder quitarlo de una vez sin tocar nada del usuario.

export const DEMO_PREFERENCE = "demo-data";

export interface DemoRecord {
  profileId: number;
  accountId: number;
  groupId: number;
  batchId: string;
  createdAt: string;
}

/** Números pseudoaleatorios reproducibles (mismo ejemplo para todos). */
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const round = (n: number) => Math.round(n * 100) / 100;

/** Los últimos `n` meses completos, del más antiguo al más reciente ("YYYY-MM"). */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 2 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  });
}

/** Nómina de ejemplo de un mes: bruto, neto y conceptos que cuadran. */
export function demoPayslip(month: string, extra = false) {
  const [, m] = month.split("-").map(Number);
  // Subida de sueldo a mitad de año: así los gráficos y las alertas tienen algo que contar.
  const base = m >= 7 ? 2150 : 2050;
  const devengos = extra
    ? [{ name: "Paga extraordinaria", amount: base }]
    : [{ name: "Salario base", amount: base }, { name: "Complemento de puesto", amount: 300 }, { name: "Plus transporte", amount: 60 }];
  const gross = round(devengos.reduce((s, c) => s + c.amount, 0));
  const deducciones = [
    { name: "IRPF", amount: round(gross * (extra ? 0.17 : 0.15)) },
    { name: "Contingencias comunes", amount: round(gross * 0.047) },
    { name: "Desempleo", amount: round(gross * 0.0155) },
    { name: "Formación profesional", amount: round(gross * 0.001) },
    { name: "MEI", amount: round(gross * 0.0013) },
  ];
  const net = round(gross - deducciones.reduce((s, c) => s + c.amount, 0));
  return { gross, net, devengos, deducciones };
}

export async function getDemoRecord(userId: number): Promise<DemoRecord | null> {
  const prefs = await listPreferences(userId);
  const v = prefs[DEMO_PREFERENCE] as DemoRecord | undefined;
  return v && typeof v.profileId === "number" ? v : null;
}

export async function createDemoData(userId: number): Promise<DemoRecord> {
  if (await getDemoRecord(userId)) throw new AppError(409, "Ya tienes los datos de ejemplo cargados");
  const today = getTodayIsoDate();
  const months = lastMonths(today, 12);
  const rand = seeded(20260311);
  const batchId = `demo-${randomUUID()}`;

  const record = await db.transaction(async (tx) => {
    const [profile] = await tx.insert(s.profiles).values({ userId, name: "Lucía (ejemplo)", color: "#8b5cf6" }).returning();
    const [account] = await tx.insert(s.accounts).values({ userId, name: "Cuenta de ejemplo", type: "bank", initialBalance: 1500, color: "#8b5cf6" }).returning();
    const [group] = await tx.insert(s.categoryGroups).values({ userId, name: "Ejemplo", sortOrder: 999 }).returning();
    const catNames = ["Alquiler", "Supermercado", "Restaurantes", "Transporte", "Suministros", "Suscripciones", "Ocio"];
    const cats = await tx.insert(s.categories).values(catNames.map((name, i) => ({ groupId: group.id, name, sortOrder: i }))).returning();
    const cat = (name: string) => cats.find((c) => c.name === name)!.id;

    const txs: Array<typeof s.transactions.$inferInsert> = [];
    const add = (date: string, type: "income" | "expense", amount: number, payee: string, category: string | null, payslipId: number | null = null) =>
      txs.push({ userId, accountId: account.id, type, amount: round(amount), date, payee, categoryId: category ? cat(category) : null, cleared: date <= today, importBatchId: batchId, payslipId });

    for (const month of months) {
      const [, m] = month.split("-").map(Number);
      const slips = [demoPayslip(month)];
      if (m === 6 || m === 12) slips.push(demoPayslip(month, true));
      for (const [i, slip] of slips.entries()) {
        const extra = i === 1;
        const [p] = await tx.insert(s.payslips).values({
          profileId: profile.id, fileName: `ejemplo-${month}${extra ? "-extra" : ""}.pdf`, periodMonth: m, periodYear: Number(month.slice(0, 4)),
          company: "Ejemplo Servicios S.L.", grossSalary: slip.gross, netSalary: slip.net, parsingStatus: "parsed",
          payslipType: extra ? "extra" : "ordinal",
        }).returning();
        await tx.insert(s.payslipConcepts).values([
          ...slip.devengos.map((c) => ({ payslipId: p.id, category: "devengo" as const, name: c.name, amount: c.amount, kind: classifyConcept(c.name, "devengo") })),
          ...slip.deducciones.map((c) => ({ payslipId: p.id, category: "deduccion" as const, name: c.name, amount: c.amount, kind: classifyConcept(c.name, "deduccion") })),
        ]);
        add(`${month}-${extra ? "20" : "28"}`, "income", slip.net, "Ejemplo Servicios S.L.", null, p.id);
      }
      add(`${month}-01`, "expense", 750, "Alquiler piso", "Alquiler");
      add(`${month}-05`, "expense", 12.99, "Netflix", "Suscripciones");
      add(`${month}-08`, "expense", 40 + rand() * 25, "Iberdrola", "Suministros");
      add(`${month}-10`, "expense", 40, "Abono transporte", "Transporte");
      for (const day of ["03", "10", "17", "24"]) add(`${month}-${day}`, "expense", 55 + rand() * 40, rand() > 0.5 ? "Mercadona" : "Lidl", "Supermercado");
      for (let k = 0; k < 3; k++) add(`${month}-${pad(12 + k * 5)}`, "expense", 18 + rand() * 30, ["La Tagliatella", "Bar Manolo", "Sushi Zen"][k], "Restaurantes");
      add(`${month}-${pad(14 + Math.floor(rand() * 10))}`, "expense", 20 + rand() * 60, rand() > 0.5 ? "Cines Yelmo" : "Libreria Central", "Ocio");
    }
    for (let i = 0; i < txs.length; i += 500) await tx.insert(s.transactions).values(txs.slice(i, i + 500));

    const current = today.slice(0, 7);
    await tx.insert(s.budgets).values([
      { userId, categoryId: cat("Supermercado"), month: current, assigned: 320 },
      { userId, categoryId: cat("Restaurantes"), month: current, assigned: 90 },
      { userId, categoryId: cat("Ocio"), month: current, assigned: 60 },
    ]);
    return { profileId: profile.id, accountId: account.id, groupId: group.id, batchId, createdAt: new Date().toISOString() };
  });

  await setPreference(userId, DEMO_PREFERENCE, record);
  return record;
}

/** Quita todo lo creado por createDemoData (y nada más). */
export async function deleteDemoData(userId: number): Promise<boolean> {
  const record = await getDemoRecord(userId);
  if (!record) return false;
  await db.transaction(async (tx) => {
    await tx.delete(s.transactions).where(and(eq(s.transactions.userId, userId), eq(s.transactions.importBatchId, record.batchId)));
    // Cascada: las nóminas del perfil, las categorías del grupo y sus presupuestos.
    await tx.delete(s.profiles).where(and(eq(s.profiles.userId, userId), inArray(s.profiles.id, [record.profileId])));
    await tx.delete(s.accounts).where(and(eq(s.accounts.userId, userId), eq(s.accounts.id, record.accountId)));
    await tx.delete(s.categoryGroups).where(and(eq(s.categoryGroups.userId, userId), eq(s.categoryGroups.id, record.groupId)));
  });
  await deletePreference(userId, DEMO_PREFERENCE);
  return true;
}
