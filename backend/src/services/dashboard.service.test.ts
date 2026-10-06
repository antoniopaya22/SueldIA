import { describe, expect, it } from "vitest";
import { buildAnnualSummaries, fetchDashboardData } from "./dashboard.service.js";

type AnnualPayslip = Parameters<typeof buildAnnualSummaries>[0][number];
type AnnualConcept = Parameters<typeof buildAnnualSummaries>[1][number];

function createPayslip(overrides: Partial<AnnualPayslip>): AnnualPayslip {
  return {
    id: 1,
    profileId: 1,
    fileName: "nomina.pdf",
    periodMonth: 1,
    periodYear: 2025,
    company: "Empresa",
    grossSalary: 0,
    netSalary: 0,
    rawText: null,
    parsingStatus: "parsed",
    payslipType: "ordinal",
    createdAt: new Date("2025-01-31T00:00:00.000Z"),
    ...overrides,
  };
}

describe("buildAnnualSummaries", () => {
  it("includes extra payslips in annual totals while keeping monthly averages based on regular payslips", () => {
    const payslips: AnnualPayslip[] = [
      createPayslip({ id: 1, periodMonth: 1, grossSalary: 2000, netSalary: 1600, payslipType: "ordinal" }),
      createPayslip({ id: 2, periodMonth: 2, grossSalary: 2200, netSalary: 1760, payslipType: "ordinal" }),
      createPayslip({ id: 3, periodMonth: 7, grossSalary: 1500, netSalary: 1200, payslipType: "extra" }),
    ];

    const concepts: AnnualConcept[] = [
      { id: 1, payslipId: 1, category: "deduccion", name: "IRPF", amount: 200, isPercentage: false },
      { id: 2, payslipId: 2, category: "deduccion", name: "IRPF", amount: 220, isPercentage: false },
      { id: 3, payslipId: 3, category: "deduccion", name: "IRPF", amount: 150, isPercentage: false },
    ];

    const [summary] = buildAnnualSummaries(payslips, concepts);

    expect(summary).toMatchObject({
      year: 2025,
      months: 2,
      totalGross: 5700,
      totalNet: 4560,
      totalDeductions: 1140,
      totalIrpf: 570,
      avgMonthlyGross: 2100,
      avgMonthlyNet: 1680,
      projectedAnnualGross: 25200,
      projectedAnnualNet: 20160,
      pagasExtra: 1,
      extraGross: 1500,
      extraNet: 1200,
      retentionRate: 80,
    });
  });
});
describe("fetchDashboardData", () => {
  it("sin perfiles válidos devuelve vacío en vez de las nóminas de todos los usuarios", async () => {
    // Se pidió un perfil ajeno: tras filtrar por propiedad no queda ninguno.
    const result = await fetchDashboardData({ userProfileIds: [1, 2], requestedProfileIds: [] });
    expect(result.filtered).toEqual([]);
    expect(result.allConcepts).toEqual([]);
  });
});
