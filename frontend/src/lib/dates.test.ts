import { describe, expect, it } from "vitest";
import { currentMonthKey, isMonthKey, monthLabel, shiftMonth, todayIso } from "./dates";

describe("fechas", () => {
  it("usa la hora local", () => {
    expect(todayIso(new Date(2026, 0, 31, 23, 30))).toBe("2026-01-31");
    expect(currentMonthKey(new Date(2026, 11, 1))).toBe("2026-12");
  });
  it("desplaza meses cruzando años", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-03", -15)).toBe("2024-12");
  });
  it("etiquetas y validación", () => {
    expect(monthLabel("2026-03")).toBe("Marzo 2026");
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-09")).toBe(true);
  });
});
