import { describe, expect, it } from "vitest";
import { addDaysIso, buildForecast, budgetScenarioItems } from "./forecast.service.js";

const item = (date: string, amount: number, payee = "x", source: "pending" | "recurring" = "pending") => ({ date, amount, payee, source });

describe("addDaysIso", () => {
  it("suma días cruzando de mes y año", () => {
    expect(addDaysIso("2025-03-30", 3)).toBe("2025-04-02");
    expect(addDaysIso("2024-12-30", 5)).toBe("2025-01-04");
  });
});

describe("buildForecast", () => {
  const base = {
    startBalance: 1000,
    today: "2025-03-10",
    days: 30,
    items: [
      item("2025-03-05", -50, "Retrasado"),            // pendiente de fecha pasada: cuenta hoy
      item("2025-03-15", -200, "Alquiler"),
      item("2025-03-31", 500, "Empresa"),
      item("2025-04-05", -10, "Netflix", "recurring"),
      item("2025-05-30", -999, "Fuera del horizonte"),  // más allá de los 30 días
    ],
  };
  const f = buildForecast(base);
  const at = (date: string) => f.points.find((p) => p.date === date)!.balance;

  it("un punto por día, de hoy al final del horizonte", () => {
    expect(f.points).toHaveLength(31);
    expect(f.points[0].date).toBe("2025-03-10");
    expect(f.points[30].date).toBe("2025-04-09");
  });

  it("proyecta el saldo con lo previsto y lo atrasado cuenta hoy", () => {
    expect(at("2025-03-10")).toBe(950);
    expect(at("2025-03-14")).toBe(950);
    expect(at("2025-03-15")).toBe(750);
    expect(at("2025-03-31")).toBe(1250);
    expect(at("2025-04-09")).toBe(1240);
  });

  it("saldo a fin de mes y mínimo del periodo", () => {
    expect(f.endOfMonth).toEqual({ date: "2025-03-31", balance: 1250 });
    expect(f.lowest).toEqual({ date: "2025-03-15", balance: 750 });
    expect(f.firstNegative).toBeNull();
  });

  it("ignora lo que cae fuera del horizonte y marca lo atrasado", () => {
    expect(f.upcoming.map((i) => i.payee)).toEqual(["Retrasado", "Alquiler", "Empresa", "Netflix"]);
    expect(f.upcoming[0]).toMatchObject({ overdue: true, date: "2025-03-10" });
    expect(f.upcoming[1].overdue).toBe(false);
  });

  it("avisa del primer día en que el saldo previsto es negativo", () => {
    const risky = buildForecast({ startBalance: 100, today: "2025-03-10", days: 30, items: [item("2025-03-12", -300)] });
    expect(risky.firstNegative).toBe("2025-03-12");
    expect(risky.lowest.balance).toBe(-200);
  });

  it("si el horizonte no llega a fin de mes, usa el último día", () => {
    const short = buildForecast({ startBalance: 10, today: "2025-03-10", days: 7, items: [] });
    expect(short.endOfMonth.date).toBe("2025-03-17");
  });
});

describe("budgetScenarioItems", () => {
  const m = (month: string, assigned: Record<number, number>, spent: Record<number, number> = {}, scheduled: Record<number, number> = {}) => ({
    month,
    assigned: new Map(Object.entries(assigned).map(([k, v]) => [Number(k), v])),
    spent: new Map(Object.entries(spent).map(([k, v]) => [Number(k), v])),
    scheduled: new Map(Object.entries(scheduled).map(([k, v]) => [Number(k), v])),
  });

  it("reparte lo que queda del mes en los días que faltan, sin contar lo ya gastado ni lo programado", () => {
    // Súper: 300 asignados, 100 gastados → 200. Alquiler: 750 asignados y programados → 0.
    // Ocio: 50 asignados y 80 gastados → 0 (no negativo).
    const { items, remainingByMonth } = budgetScenarioItems("2025-03-22", "2025-03-31", [
      m("2025-03", { 1: 300, 2: 750, 3: 50 }, { 1: 100, 3: 80 }, { 2: 750 }),
    ]);
    expect(remainingByMonth).toEqual([{ month: "2025-03", amount: 200 }]);
    expect(items).toHaveLength(10); // del 22 al 31
    expect(items.reduce((s, i) => s + i.amount, 0)).toBeCloseTo(-200);
  });

  it("los meses siguientes empiezan el día 1 y el horizonte corta el reparto", () => {
    const { items } = budgetScenarioItems("2025-03-31", "2025-04-10", [m("2025-03", {}), m("2025-04", { 1: 300 })]);
    expect(items[0].date).toBe("2025-04-01");
    expect(items).toHaveLength(10);
    expect(items[0].amount).toBeCloseTo(-10); // 300 / 30 días
  });
});

