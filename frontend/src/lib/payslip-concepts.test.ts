import { describe, expect, it } from "vitest";
import { irpfAmount, isIrpfConcept, socialSecurityAmount } from "./payslip-concepts";

const c = (name: string, amount: number, kind?: string, isPercentage = false) =>
  ({ name, amount, kind, isPercentage, category: "deduccion" as const });

describe("conceptos de la nómina", () => {
  it("usa el tipo guardado y, si falta, el nombre", () => {
    expect(isIrpfConcept(c("Retención", 1, "irpf"))).toBe(true);
    expect(isIrpfConcept(c("I.R.P.F.", 1))).toBe(true);
    expect(isIrpfConcept(c("Contingencias", 1, "ss_contingencias"))).toBe(false);
  });
  it("suma importes en euros, no porcentajes", () => {
    const list = [c("IRPF", 300, "irpf"), c("IRPF", 15, "irpf", true), c("Cont. comunes", 94, "ss_contingencias"), c("Desempleo", 31, "ss_desempleo"), c("Anticipo", 100, "otros")];
    expect(irpfAmount(list)).toBe(300);
    expect(socialSecurityAmount(list)).toBe(125);
  });
});
