import { describe, expect, it } from "vitest";
import { buildAnnualSummaries, buildHousehold, fetchDashboardData } from "./dashboard.service.js";

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
    manuallyEdited: false,
    contentHash: null,
    parserFormat: null,
    parseMs: null,
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
      // 12 mensualidades a la media + la extra cobrada.
      projectedAnnualGross: 26700,
      projectedAnnualNet: 21360,
      pagasExtra: 1,
      extraGross: 1500,
      extraNet: 1200,
      retentionRate: 80,
    });
  });
});
describe("proyección anual con las pagas del perfil", () => {
  it("con 14 pagas cuenta la extra que aún no ha llegado", () => {
    const payslips: AnnualPayslip[] = [
      createPayslip({ id: 1, periodMonth: 1, grossSalary: 2000, netSalary: 1600 }),
      createPayslip({ id: 2, periodMonth: 2, grossSalary: 2000, netSalary: 1600 }),
      createPayslip({ id: 3, periodMonth: 6, grossSalary: 2000, netSalary: 1600, payslipType: "extra" }),
    ];
    const [summary] = buildAnnualSummaries(payslips, [], 14);
    expect(summary.projectedAnnualGross).toBe(2000 * 12 + 2000 + 2000);
    // Sin saber las pagas, solo las extras cobradas.
    expect(buildAnnualSummaries(payslips, [])[0].projectedAnnualGross).toBe(2000 * 12 + 2000);
  });
});

describe("buildHousehold", () => {
  const profileMap = new Map([
    [1, { id: 1, name: "Ana", color: "#2a8558", paymentsPerYear: 14 }],
    [2, { id: 2, name: "Luis", color: "#3b82f6", paymentsPerYear: null }],
  ]);

  it("reparte el neto del hogar por perfil y suma las proyecciones de cada uno", () => {
    const payslips: AnnualPayslip[] = [
      createPayslip({ id: 1, profileId: 1, periodMonth: 1, grossSalary: 2000, netSalary: 1500 }),
      createPayslip({ id: 2, profileId: 1, periodMonth: 2, grossSalary: 2000, netSalary: 1500 }),
      createPayslip({ id: 3, profileId: 2, periodMonth: 1, grossSalary: 1500, netSalary: 1000 }),
      createPayslip({ id: 4, profileId: 2, periodMonth: 2, grossSalary: 1500, netSalary: 1000 }),
    ];
    const concepts: AnnualConcept[] = [
      { id: 1, payslipId: 1, category: "deduccion", name: "IRPF", amount: 300, isPercentage: false },
      { id: 2, payslipId: 3, category: "deduccion", name: "IRPF", amount: 150, isPercentage: false },
    ];
    const [year] = buildHousehold(payslips, concepts, profileMap);
    expect(year.totalNet).toBe(5000);
    expect(year.totalIrpf).toBe(450);
    expect(year.members.map((m) => [m.name, m.shareOfNet, m.totalIrpf])).toEqual([["Ana", 60, 300], ["Luis", 40, 150]]);
    // Ana: 14 pagas (12 + 2 extras que faltan); Luis: sin saberlo, 12.
    expect(year.projectedAnnualNet).toBe(1500 * 14 + 1000 * 12);
  });

  it("con un solo perfil no hay vista de hogar", () => {
    const payslips = [createPayslip({ id: 1, profileId: 1, periodMonth: 1, grossSalary: 2000, netSalary: 1500 })];
    expect(buildHousehold(payslips, [], profileMap)).toEqual([]);
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
