import { describe, expect, it } from "vitest";
import { isPartialMonth, pctChange, previousRange, rangeDays } from "./analytics-compare";
import { moveItem } from "./reorder";

describe("comparación con el periodo anterior", () => {
  it("rango anterior de la misma duración", () => {
    expect(rangeDays("2026-03-01", "2026-03-31")).toBe(31);
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ from: "2026-01-29", to: "2026-02-28" });
    expect(previousRange("2026-03-31", "2026-03-01")).toBeNull();
  });
  it("mes parcial en los bordes", () => {
    const range = { from: "2026-01-26", to: "2026-03-31" };
    expect(isPartialMonth("2026-01", range)).toBe(true);
    expect(isPartialMonth("2026-02", range)).toBe(false);
    expect(isPartialMonth("2026-03", range)).toBe(false);
  });
  it("variación porcentual sin base es null", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(-50, -100)).toBeCloseTo(50);
  });
});

describe("moveItem", () => {
  it("mueve sin mutar y tolera índices fuera de rango", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(list).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 5, 0)).toEqual(list);
  });
});
