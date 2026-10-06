import { describe, expect, it } from "vitest";
import type { BudgetSummary } from "./budgets.service.js";
import { isoWeekKey, lowBalanceCandidates, overdueCandidates, overspentCandidates } from "./finance-alerts.service.js";

const cat = (id: number, name: string, assigned: number, carryIn: number, spent: number) => ({
  id, name, assigned, activity: -spent, carryIn, available: assigned + carryIn - spent, target: null,
});

const summary: BudgetSummary = {
  month: "2025-03",
  readyToAssign: 0,
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
