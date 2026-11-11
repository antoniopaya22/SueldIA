import { describe, expect, it } from "vitest";
import { alertConfigSchemas, nextPeriod } from "./alerts.service.js";

describe("nextPeriod", () => {
  it("advances within the same year", () => {
    expect(nextPeriod(2026, 3)).toEqual({ year: 2026, month: 4 });
  });

  it("wraps around into the next year after december", () => {
    expect(nextPeriod(2026, 12)).toEqual({ year: 2027, month: 1 });
  });
});

describe("alertConfigSchemas", () => {
  it("applies defaults for salary_drop", () => {
    const result = alertConfigSchemas.salary_drop.parse({});
    expect(result).toEqual({ thresholdPercent: 10 });
  });

  it("rejects a threshold above 100%", () => {
    const result = alertConfigSchemas.salary_drop.safeParse({ thresholdPercent: 150 });
    expect(result.success).toBe(false);
  });

  it("requires conceptName for concept_change", () => {
    const result = alertConfigSchemas.concept_change.safeParse({ thresholdPercent: 20 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid concept_change config", () => {
    const result = alertConfigSchemas.concept_change.parse({ conceptName: "IRPF" });
    expect(result).toEqual({ conceptName: "IRPF", thresholdPercent: 15 });
  });

  it("requires metric and comparator for custom_threshold", () => {
    const result = alertConfigSchemas.custom_threshold.safeParse({ value: 1500 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid custom_threshold config", () => {
    const result = alertConfigSchemas.custom_threshold.parse({
      metric: "net",
      comparator: "below",
      value: 1500,
    });
    expect(result.metric).toBe("net");
  });

  it("rejects a negative graceDays for missing_payslip", () => {
    const result = alertConfigSchemas.missing_payslip.safeParse({ graceDays: -1 });
    expect(result.success).toBe(false);
  });
});

describe("IRPF", () => {
  it("reconoce las formas habituales del concepto", async () => {
    const { isIrpfConceptName } = await import("./alerts.service.js");
    for (const name of ["IRPF", "Retención I.R.P.F.", "I.R.P.F. 15%", "Retención a cuenta", "Tributación IRPF"]) {
      expect(isIrpfConceptName(name), name).toBe(true);
    }
    for (const name of ["Contingencias comunes", "Desempleo", "Salario base", "Irpfx"]) {
      expect(isIrpfConceptName(name), name).toBe(false);
    }
  });

  it("calcula el tipo efectivo sobre el bruto", async () => {
    const { effectiveIrpfRate } = await import("./alerts.service.js");
    const concepts = [
      { category: "deduccion", name: "IRPF", amount: 300, isPercentage: false },
      { category: "deduccion", name: "IRPF", amount: 15, isPercentage: true },
      { category: "deduccion", name: "Contingencias comunes", amount: 100, isPercentage: false },
    ];
    expect(effectiveIrpfRate(2000, concepts)).toBeCloseTo(15);
    expect(effectiveIrpfRate(null, concepts)).toBeNull();
    expect(effectiveIrpfRate(2000, [])).toBeNull();
  });
});
