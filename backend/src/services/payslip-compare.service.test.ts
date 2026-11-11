import { describe, expect, it } from "vitest";
import { buildTaxSummary, diffConcepts } from "./payslip-compare.service.js";

const c = (name: string, category: "devengo" | "deduccion", amount: number, isPercentage = false) => ({ name, category, amount, isPercentage });

describe("diffConcepts", () => {
  it("empareja por nombre, detecta nuevos y desaparecidos e ignora porcentajes", () => {
    const rows = diffConcepts(
      [c("Salario base", "devengo", 2000), c("Plus transporte", "devengo", 100), c("IRPF", "deduccion", 330), c("IRPF", "deduccion", 15, true)],
      [c("SALARIO BASE", "devengo", 1900), c("IRPF", "deduccion", 300), c("Antigüedad", "devengo", 50)],
    );
    expect(rows).toEqual([
      { name: "Salario base", category: "devengo", current: 2000, other: 1900, change: 100 },
      { name: "Plus transporte", category: "devengo", current: 100, other: null, change: null },
      { name: "Antigüedad", category: "devengo", current: null, other: 50, change: null },
      { name: "IRPF", category: "deduccion", current: 330, other: 300, change: 30 },
    ]);
  });
});

describe("buildTaxSummary", () => {
  it("suma bruto, retenciones, cotizaciones y detecta meses sin nómina", () => {
    const payslips = [
      { id: 1, grossSalary: 2000, netSalary: 1600, periodMonth: 1, payslipType: "ordinal" },
      { id: 2, grossSalary: 2000, netSalary: 1600, periodMonth: 2, payslipType: "ordinal" },
      { id: 3, grossSalary: 1500, netSalary: 1300, periodMonth: 6, payslipType: "extra" },
    ];
    const concepts = [
      { payslipId: 1, ...c("IRPF", "deduccion", 300) },
      { payslipId: 1, ...c("Contingencias comunes", "deduccion", 100) },
      { payslipId: 2, ...c("Retención I.R.P.F.", "deduccion", 300) },
      { payslipId: 2, ...c("Desempleo", "deduccion", 31) },
      { payslipId: 3, ...c("IRPF", "deduccion", 200) },
      { payslipId: 9, ...c("IRPF", "deduccion", 999) }, // de otra nómina: no cuenta
    ];
    const s = buildTaxSummary(2026, payslips, concepts);
    expect(s).toMatchObject({ payslips: 3, grossTotal: 5500, irpfWithheld: 800, socialSecurity: 131, netTotal: 4500 });
    expect(s.effectiveIrpfRate).toBeCloseTo(14.55, 2);
    expect(s.missingMonths).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
