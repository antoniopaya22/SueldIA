import { describe, expect, it } from "vitest";
import { formatCurrency, formatDecimalInput, formatPct, parseDecimal } from "./format";

describe("parseDecimal", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1234,56", 1234.56],
    ["1234.56", 1234.56],
    ["12,5", 12.5],
    ["12.50", 12.5],
    ["1.234", 1234],
    ["-3,2", -3.2],
    [" 20,99 € ", 20.99],
  ])("%s → %s", (raw, expected) => {
    expect(parseDecimal(raw)).toBe(expected);
  });

  it("vacío es null y lo que no es un número es NaN", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("abc")).toBeNaN();
    expect(parseDecimal("1,2,3")).toBeNaN();
  });
});

describe("formatDecimalInput", () => {
  it("usa coma decimal, sin miles, y deja vacío lo desconocido", () => {
    expect(formatDecimalInput(1234.5)).toBe("1234,5");
    expect(formatDecimalInput(null)).toBe("");
    expect(formatDecimalInput(Number.NaN)).toBe("");
  });
});

describe("formatos", () => {
  it("moneda con miles siempre y guion para vacío", () => {
    expect(formatCurrency(1798.75).replace(/\s/g, " ")).toBe("1.798,75 €");
    expect(formatCurrency(null)).toBe("—");
  });
  it("porcentaje a la española", () => {
    expect(formatPct(77.66)).toBe("77,7 %");
  });
});
