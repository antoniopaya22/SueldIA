import { describe, expect, it } from "vitest";
import { buildYearReport } from "./year-report.service.js";
import type { ReportRow } from "./month-report.service.js";

let id = 1;
const row = (date: string, type: "income" | "expense", amount: number, cat = "Casa", payee = "X"): ReportRow => ({
  id: id++, date, type, amount, categoryId: cat === "Casa" ? 1 : 2, categoryName: cat, groupName: "G", payee,
});

describe("buildYearReport", () => {
  const rows = [
    row("2025-01-05", "income", 2000), row("2025-01-10", "expense", 800), row("2025-04-10", "expense", 900),
    row("2026-01-05", "income", 2100), row("2026-01-10", "expense", 700, "Casa", "Alquiler"),
    row("2026-02-05", "income", 2100), row("2026-02-12", "expense", 1500, "Ocio", "Viaje"),
    row("2026-03-05", "income", 2100), row("2026-03-08", "expense", 50, "Ocio", "Cine"),
  ];

  it("año en curso: compara con el mismo periodo del anterior", () => {
    const r = buildYearReport(rows, 2026, "2026-03-20");
    expect(r).toMatchObject({ partial: true, throughMonth: 3 });
    expect(r.totals).toEqual({ income: 6300, expense: 2250, net: 4050, savingsRate: 64.29 });
    // 2025 hasta marzo: el gasto de abril no cuenta.
    expect(r.previousTotals).toEqual({ income: 2000, expense: 800, net: 1200, savingsRate: 60 });
    expect(r.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    // Marzo aún no ha terminado: no compite por mejor/peor mes.
    expect(r.bestMonth).toEqual({ month: "2026-01", net: 1400 });
    expect(r.worstMonth).toEqual({ month: "2026-02", net: 600 });
    expect(r.categories[0]).toMatchObject({ name: "Ocio", spent: 1550, previous: 0, diffPct: null });
    expect(r.categories[1]).toMatchObject({ name: "Casa", spent: 700, previous: 800, diffPct: -12.5 });
    expect(r.topPayees[0]).toEqual({ payee: "Viaje", spent: 1500, count: 1 });
    expect(r.biggestExpenses.map((e) => e.amount)).toEqual([1500, 700, 50]);
  });

  it("año cerrado: los 12 meses", () => {
    const r = buildYearReport(rows, 2025, "2026-03-20");
    expect(r).toMatchObject({ partial: false, throughMonth: 12 });
    expect(r.months).toHaveLength(12);
    expect(r.totals.expense).toBe(1700);
  });
});
