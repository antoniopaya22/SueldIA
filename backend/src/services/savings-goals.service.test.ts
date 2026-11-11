import { describe, expect, it } from "vitest";
import { goalProgress } from "./savings-goals.service.js";

describe("goalProgress", () => {
  it("aportación mensual para llegar a tiempo (contando el mes actual)", () => {
    expect(goalProgress({ targetAmount: 2000, targetDate: "2026-07-15" }, 800, "2026-03-10")).toEqual({
      saved: 800, remaining: 1200, percent: 40, monthsLeft: 5, monthlyNeeded: 240, status: "on-track",
    });
  });
  it("conseguido, sin fecha y fuera de plazo", () => {
    expect(goalProgress({ targetAmount: 500, targetDate: null }, 600, "2026-03-10")).toMatchObject({ status: "done", remaining: 0, percent: 120 });
    expect(goalProgress({ targetAmount: 500, targetDate: null }, 100, "2026-03-10")).toMatchObject({ status: "no-date", monthlyNeeded: null });
    expect(goalProgress({ targetAmount: 500, targetDate: "2026-01-31" }, 100, "2026-03-10")).toMatchObject({ status: "overdue", monthsLeft: 0 });
  });
  it("el mismo mes de la fecha: todo lo que falta", () => {
    expect(goalProgress({ targetAmount: 300, targetDate: "2026-03-31" }, 100, "2026-03-10")).toMatchObject({ monthsLeft: 1, monthlyNeeded: 200 });
  });
});
