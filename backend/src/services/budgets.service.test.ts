import { describe, expect, it } from "vitest";
import { assembleBudgetSummary } from "./budgets.service.js";

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
