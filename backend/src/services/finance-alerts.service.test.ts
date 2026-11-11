import { describe, expect, it } from "vitest";
import type { BudgetSummary } from "./budgets.service.js";
import { isoWeekKey, lowBalanceCandidates, overdueCandidates, overspentCandidates } from "./finance-alerts.service.js";

const cat = (id: number, name: string, assigned: number, carryIn: number, spent: number) => ({
  id, name, assigned, activity: -spent, carryIn, available: assigned + carryIn - spent, target: null,
});

const summary: BudgetSummary = {
  month: "2025-03",
  readyToAssign: 0,
  readyBreakdown: { income: 0, initialBalances: 0, assigned: 0 },
  uncategorizedActivity: 0,
  targetsShortfall: 0,
  groups: [{
    id: 1,
    name: "Comida",
    categories: [
      cat(1, "Supermercado", 300, 0, 350),   // pasado 50 de 300 → warning
      cat(2, "Restaurantes", 100, 0, 180),   // pasado 80 de 100 → critical
      cat(3, "Ocio", 100, 0, 60),            // dentro
      cat(4, "Sin presupuesto", 0, 0, 40),   // no presupuestó nada: no hay presupuesto que superar
    ],
  }],
};

describe("overspentCandidates", () => {
  it("avisa de las categorías con presupuesto que se han pasado, con su gravedad", () => {
    const out = overspentCandidates(summary, {}, 7);
    expect(out.map((c) => [c.dedupeKey, c.severity])).toEqual([
      ["overspent:7:1:2025-03", "warning"],
      ["overspent:7:2:2025-03", "critical"],
    ]);
    expect(out[0].message).toContain("Supermercado");
  });

  it("puede limitarse a una categoría", () => {
    expect(overspentCandidates(summary, { categoryId: 2 }, 7)).toHaveLength(1);
    expect(overspentCandidates(summary, { categoryId: 3 }, 7)).toHaveLength(0);
  });
});

describe("lowBalanceCandidates", () => {
  const accounts = [
    { id: 1, name: "BBVA", type: "bank", archived: false, balance: 80 },
    { id: 2, name: "Efectivo", type: "cash", archived: false, balance: 500 },
    { id: 3, name: "Visa", type: "credit_card", archived: false, balance: -300 },
    { id: 4, name: "Vieja", type: "bank", archived: true, balance: 5 },
    { id: 5, name: "Nómina", type: "bank", archived: false, balance: -20 },
  ];

  it("vigila las cuentas bajo el umbral, sin tarjetas ni archivadas", () => {
    const out = lowBalanceCandidates(accounts, { threshold: 100 }, "2025-03", 1);
    expect(out.map((c) => [c.dedupeKey, c.severity])).toEqual([
      ["low_balance:1:1:2025-03", "warning"],
      ["low_balance:1:5:2025-03", "critical"], // en negativo
    ]);
  });

  it("una tarjeta solo se vigila si se elige a propósito", () => {
    expect(lowBalanceCandidates(accounts, { accountId: 3, threshold: 0 }, "2025-03", 1)).toHaveLength(1);
  });

  it("no repite el aviso dentro del mismo mes", () => {
    const a = lowBalanceCandidates(accounts, { threshold: 100 }, "2025-03", 1).map((c) => c.dedupeKey);
    const b = lowBalanceCandidates(accounts, { threshold: 100 }, "2025-03", 1).map((c) => c.dedupeKey);
    expect(a).toEqual(b);
  });
});

describe("overdueCandidates", () => {
  const pending = [
    { date: "2025-03-01", amount: 40 },
    { date: "2025-03-05", amount: 60 },
    { date: "2025-03-09", amount: 10 }, // dentro del margen
  ];

  it("resume en una sola alerta los pendientes con retraso", () => {
    const out = overdueCandidates(pending, { graceDays: 3 }, "2025-03-10", 4);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain("2 movimientos pendientes");
    expect(out[0].message).toContain("100,00");
  });

  it("nada si no hay retraso", () => {
    expect(overdueCandidates(pending, { graceDays: 30 }, "2025-03-10", 4)).toEqual([]);
    expect(overdueCandidates([], { graceDays: 3 }, "2025-03-10", 4)).toEqual([]);
  });

  it("una alerta por semana como mucho", () => {
    const a = overdueCandidates(pending, { graceDays: 3 }, "2025-03-10", 4)[0].dedupeKey;
    const sameWeek = overdueCandidates(pending, { graceDays: 3 }, "2025-03-14", 4)[0].dedupeKey;
    const nextWeek = overdueCandidates(pending, { graceDays: 3 }, "2025-03-17", 4)[0].dedupeKey;
    expect(sameWeek).toBe(a);
    expect(nextWeek).not.toBe(a);
  });
});

describe("isoWeekKey", () => {
  it.each([
    ["2025-03-10", "2025-W11"],
    ["2025-03-16", "2025-W11"], // domingo, misma semana
    ["2025-03-17", "2025-W12"],
    ["2024-12-30", "2025-W01"], // el lunes de diciembre que ya es semana 1 de 2025
    ["2021-01-03", "2020-W53"], // domingo que aún es semana 53 de 2020
    ["2026-01-01", "2026-W01"],
  ])("%s → %s", (date, expected) => {
    expect(isoWeekKey(date)).toBe(expected);
  });
});

describe("reglas nuevas de finanzas", () => {
  it("presupuesto: aviso previo al llegar al % pedido (además del de pasarse)", () => {
    const out = overspentCandidates(summary, { warnAtPercent: 50 }, 7);
    expect(out.map((c) => c.dedupeKey)).toEqual(["overspent:7:1:2025-03", "overspent:7:2:2025-03", "budget_near:7:3:2025-03"]);
    expect(out[2].message).toContain("60 %");
  });

  it("saldo bajo previsto dentro del horizonte", async () => {
    const { forecastCandidates } = await import("./finance-alerts.service.js");
    const points = [
      { date: "2026-03-01", balance: 500 }, { date: "2026-03-05", balance: 80 },
      { date: "2026-03-10", balance: -20 }, { date: "2026-04-30", balance: -900 },
    ];
    const out = forecastCandidates(points, { threshold: 100, days: 14 }, "2026-03-01", 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", dedupeKey: "low_forecast:3:2026-W09" });
    expect(out[0].message).toContain("5 de marzo");
    expect(forecastCandidates(points, { threshold: 50, days: 3 }, "2026-03-01", 3)).toEqual([]);
  });

  it("subida de precio de una suscripción mensual", async () => {
    const { priceIncreaseCandidates } = await import("./finance-alerts.service.js");
    const charge = (id: number, date: string, amount: number, payee = "Netflix") => ({ id, date, amount, payee, accountId: 1 });
    const rows = [charge(1, "2026-01-05", 12.99), charge(2, "2026-02-05", 12.99), charge(3, "2026-03-05", 12.99), charge(4, "2026-04-05", 15.99)];
    const out = priceIncreaseCandidates(rows, { thresholdPercent: 5 }, "2026-04-10", 9);
    expect(out).toMatchObject([{ dedupeKey: "price_up:9:4" }]);
    expect(out[0].message).toContain("23 %");
    // Cargos sueltos (no mensuales) o sin subida: nada.
    expect(priceIncreaseCandidates([charge(1, "2026-01-05", 10), charge(2, "2026-01-20", 10), charge(3, "2026-03-01", 10), charge(4, "2026-04-05", 20)], { thresholdPercent: 5 }, "2026-04-10", 9)).toEqual([]);
    expect(priceIncreaseCandidates(rows.slice(0, 3), { thresholdPercent: 5 }, "2026-03-10", 9)).toEqual([]);
  });

  it("cargo duplicado: misma cuenta, beneficiario e importe en pocos días", async () => {
    const { duplicateChargeCandidates } = await import("./finance-alerts.service.js");
    const rows = [
      { id: 1, date: "2026-03-01", amount: 49.9, payee: "Amazon", accountId: 1 },
      { id: 2, date: "2026-03-02", amount: 49.9, payee: "AMAZON ", accountId: 1 },
      { id: 3, date: "2026-03-02", amount: 49.9, payee: "Amazon", accountId: 2 }, // otra cuenta
      { id: 4, date: "2026-03-01", amount: 2.5, payee: "Café", accountId: 1 },
      { id: 5, date: "2026-03-01", amount: 2.5, payee: "Café", accountId: 1 }, // por debajo del mínimo
    ];
    expect(duplicateChargeCandidates(rows, { windowDays: 2, minAmount: 5 }, 4).map((c) => c.dedupeKey)).toEqual(["duplicate:4:1:2"]);
    expect(duplicateChargeCandidates(rows, { windowDays: 0, minAmount: 5 }, 4)).toEqual([]);
  });

  it("gasto inusual en una categoría frente a su media", async () => {
    const { unusualSpendCandidates } = await import("./finance-alerts.service.js");
    const m = (month: string, spent: number) => ({ categoryId: 5, name: "Ocio", month, spent });
    const rows = [m("2025-12", 100), m("2026-01", 120), m("2026-02", 80), m("2026-03", 260)];
    expect(unusualSpendCandidates(rows, { factor: 1.5, minDifference: 50 }, "2026-03", 2).map((c) => c.dedupeKey)).toEqual(["unusual:2:5:2026-03"]);
    // Poca diferencia absoluta o poco historial: nada.
    expect(unusualSpendCandidates(rows, { factor: 1.5, minDifference: 200 }, "2026-03", 2)).toEqual([]);
    expect(unusualSpendCandidates(rows.slice(2), { factor: 1.5, minDifference: 50 }, "2026-03", 2)).toEqual([]);
  });
});
