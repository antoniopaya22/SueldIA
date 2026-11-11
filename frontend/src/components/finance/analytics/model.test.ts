import { describe, expect, it } from "vitest";
import { accumulate, rankValue } from "./model";

describe("rankValue", () => {
  it("importe, frecuencia o media", () => {
    expect(rankValue(300, 3, "total")).toBe(300);
    expect(rankValue(300, 3, "count")).toBe(3);
    expect(rankValue(300, 3, "average")).toBe(100);
    expect(rankValue(0, 0, "average")).toBe(0); // sin dividir entre cero
  });
});

describe("accumulate", () => {
  it("acumula mes a mes sin perder los campos del mes", () => {
    const out = accumulate([
      { month: "2026-01", income: 100, expenses: 40, net: 60, transactionCount: 3 },
      { month: "2026-02", income: 50, expenses: 70, net: -20, transactionCount: 2 },
    ]);
    expect(out[1]).toEqual({
      month: "2026-02", income: 50, expenses: 70, net: -20, transactionCount: 2,
      cumulativeIncome: 150, cumulativeExpenses: 110, cumulativeNet: 40, cumulativeCount: 5,
    });
  });
});
