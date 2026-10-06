import { describe, expect, it } from "vitest";
import {
  assembleBudgetSummary, evaluateTarget, monthsBetween, planFill, shiftMonthKey,
} from "./budgets.service.js";

const groupRows = [{ id: 1, name: "Casa" }];
const catRows = [
  { id: 10, groupId: 1, name: "Alquiler" },
  { id: 11, groupId: 1, name: "Luz" },
];

describe("assembleBudgetSummary", () => {
  it("arrastra el sobrante: disponible = asignado acumulado + gasto acumulado", () => {
    const summary = assembleBudgetSummary({
      month: "2025-02",
      groupRows,
      catRows,
      assignedThisMonth: new Map([[10, 500]]),
      cumulativeAssigned: new Map([[10, 1000], [11, 80]]),
      activityThisMonth: new Map([[10, -450]]),
      cumulativeActivity: new Map([[10, -900], [11, -60.5]]),
      incomeThroughMonth: 3000,
    });

    const [alquiler, luz] = summary.groups[0].categories;
    expect(alquiler).toMatchObject({ assigned: 500, activity: -450, available: 100 });
    // Sin asignación ni gasto este mes, conserva lo que arrastra de antes.
    expect(luz).toMatchObject({ assigned: 0, activity: 0, available: 19.5 });
  });

  it("Para presupuestar = ingresos acumulados − asignado acumulado, y puede ser negativo", () => {
    const base = {
      month: "2025-02",
      groupRows,
      catRows,
      assignedThisMonth: new Map<number, number>(),
      activityThisMonth: new Map<number, number>(),
      cumulativeActivity: new Map<number, number>(),
    };
    const positive = assembleBudgetSummary({
      ...base,
      cumulativeAssigned: new Map([[10, 1000], [11, 200]]),
      incomeThroughMonth: 1500,
    });
    expect(positive.readyToAssign).toBe(300);

    const negative = assembleBudgetSummary({
      ...base,
      cumulativeAssigned: new Map([[10, 1000], [11, 600]]),
      incomeThroughMonth: 1500,
    });
    expect(negative.readyToAssign).toBe(-100);
  });

  it("incluye grupos y categorías sin movimientos, a cero", () => {
    const summary = assembleBudgetSummary({
      month: "2025-02",
      groupRows: [...groupRows, { id: 2, name: "Ocio" }],
      catRows,
      assignedThisMonth: new Map(),
      cumulativeAssigned: new Map(),
      activityThisMonth: new Map(),
      cumulativeActivity: new Map(),
      incomeThroughMonth: 0,
    });
    expect(summary.groups.map((g) => g.name)).toEqual(["Casa", "Ocio"]);
    expect(summary.groups[1].categories).toEqual([]);
    expect(summary.groups[0].categories.every((c) => c.available === 0)).toBe(true);
  });
});

describe("shiftMonthKey / monthsBetween", () => {
  it("desplaza meses cruzando de año", () => {
    expect(shiftMonthKey("2025-01", -1)).toBe("2024-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(shiftMonthKey("2025-03", -3)).toBe("2024-12");
    expect(shiftMonthKey("2025-03", 0)).toBe("2025-03");
  });

  it("cuenta meses entre dos claves", () => {
    expect(monthsBetween("2025-03", "2025-03")).toBe(0);
    expect(monthsBetween("2025-03", "2025-08")).toBe(5);
    expect(monthsBetween("2024-11", "2025-02")).toBe(3);
    expect(monthsBetween("2025-05", "2025-02")).toBe(-3);
  });
});

describe("evaluateTarget", () => {
  it("mensual: falta lo que no se ha asignado todavía", () => {
    const t = { type: "monthly" as const, amount: 200, targetMonth: null };
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 0, assigned: 150 })).toMatchObject({ needed: 200, shortfall: 50, funded: false });
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 0, assigned: 200 })).toMatchObject({ shortfall: 0, funded: true });
    // Asignar de más no genera "falta" negativa.
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 0, assigned: 260 })).toMatchObject({ shortfall: 0, funded: true });
  });

  it("por fecha: reparte lo que falta entre los meses que quedan (este incluido)", () => {
    const t = { type: "by_date" as const, amount: 1200, targetMonth: "2025-06" };
    // marzo, abril, mayo y junio = 4 meses; ya hay 0 → 300 al mes.
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 0, assigned: 0 })).toMatchObject({ needed: 300, shortfall: 300 });
    // con 300 ya ahorrados al empezar abril, quedan 3 meses para 900 → 300.
    expect(evaluateTarget(t, { month: "2025-04", carryIn: 300, assigned: 100 })).toMatchObject({ needed: 300, shortfall: 200 });
    // el último mes pide todo lo que falte.
    expect(evaluateTarget(t, { month: "2025-06", carryIn: 900, assigned: 0 })).toMatchObject({ needed: 300, shortfall: 300 });
  });

  it("por fecha: redondea hacia arriba al céntimo para no quedarse corto", () => {
    const t = { type: "by_date" as const, amount: 100, targetMonth: "2025-05" };
    // 3 meses para 100 € = 33,333… → 33,34
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 0, assigned: 0 }).needed).toBe(33.34);
  });

  it("por fecha: ya cumplido, o fecha pasada", () => {
    const t = { type: "by_date" as const, amount: 500, targetMonth: "2025-06" };
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 500, assigned: 0 })).toMatchObject({ needed: 0, shortfall: 0, funded: true });
    expect(evaluateTarget(t, { month: "2025-03", carryIn: 800, assigned: 0 })).toMatchObject({ needed: 0, funded: true });
    // pasada la fecha, se pide todo lo que falta de golpe
    expect(evaluateTarget(t, { month: "2025-09", carryIn: 100, assigned: 0 })).toMatchObject({ needed: 400, shortfall: 400 });
  });
});

describe("planFill", () => {
  it("solo propone categorías sin asignación este mes e importes positivos", () => {
    const plan = planFill(
      new Map([[1, 100], [2, 50.456], [3, 0], [4, -5], [5, 30]]),
      new Map([[1, 80], [5, 0]]),
    );
    // 1 ya tiene 80 asignados (no se pisa); 3 y 4 no son positivos.
    expect([...plan]).toEqual([[2, 50.46], [5, 30]]);
  });
});

describe("assembleBudgetSummary · arrastre y objetivos", () => {
  it("calcula el arrastre inicial y evalúa el objetivo con él", () => {
    const summary = assembleBudgetSummary({
      month: "2025-04",
      groupRows: [{ id: 1, name: "Ahorro" }],
      catRows: [{ id: 10, groupId: 1, name: "Vacaciones" }],
      assignedThisMonth: new Map([[10, 100]]),
      cumulativeAssigned: new Map([[10, 400]]),         // 300 de meses anteriores + 100 de este
      activityThisMonth: new Map([[10, -20]]),
      cumulativeActivity: new Map([[10, -20]]),
      incomeThroughMonth: 1000,
      targets: new Map([[10, { type: "by_date" as const, amount: 1200, targetMonth: "2025-06" }]]),
    });
    const [vacaciones] = summary.groups[0].categories;
    expect(vacaciones).toMatchObject({ assigned: 100, activity: -20, available: 380, carryIn: 300 });
    // abril, mayo, junio = 3 meses; faltan 900 → 300; ya asignó 100 → faltan 200.
    expect(vacaciones.target).toMatchObject({ needed: 300, shortfall: 200, funded: false });
    expect(summary.targetsShortfall).toBe(200);
  });

  it("sin objetivos no hay faltante", () => {
    const summary = assembleBudgetSummary({
      month: "2025-04", groupRows, catRows,
      assignedThisMonth: new Map(), cumulativeAssigned: new Map(),
      activityThisMonth: new Map(), cumulativeActivity: new Map(), incomeThroughMonth: 0,
    });
    expect(summary.targetsShortfall).toBe(0);
    expect(summary.groups[0].categories.every((c) => c.target === null)).toBe(true);
  });
});
