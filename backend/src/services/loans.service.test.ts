import { describe, expect, it } from "vitest";
import { adjustmentAt, amortizationSchedule, loanPosition, monthlyPayment } from "./loans.service.js";

describe("monthlyPayment", () => {
  it("cuota del sistema francés", () => {
    // 100.000 € a 25 años al 3 % → 474,21 €/mes (simuladores de los bancos).
    expect(monthlyPayment(100_000, 3, 300)).toBe(474.21);
    expect(monthlyPayment(12_000, 0, 24)).toBe(500);
  });
});

describe("amortizationSchedule", () => {
  const rows = amortizationSchedule({ principal: 10_000, annualRate: 6, months: 12, firstPaymentDate: "2025-01-31" });

  it("intereses sobre el pendiente, la última cuota salda y las fechas no se pasan de mes", () => {
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ n: 1, date: "2025-01-31", interest: 50, payment: 860.66 });
    expect(rows[1].date).toBe("2025-02-28");
    expect(rows[2].date).toBe("2025-03-31");
    expect(rows[11].remaining).toBe(0);
    const totalPrincipal = rows.reduce((s, r) => s + r.principal, 0);
    expect(Math.round(totalPrincipal * 100) / 100).toBe(10_000);
  });

  it("posición a una fecha: cuotas pagadas, intereses y capital pendiente", () => {
    const p = loanPosition(rows, 10_000, "2025-03-15");
    expect(p.paidCount).toBe(2);
    expect(p.remainingCount).toBe(10);
    expect(p.theoreticalRemaining).toBe(rows[1].remaining);
    expect(p.nextPayment?.n).toBe(3);
    expect(p.endDate).toBe("2025-12-31");
    expect(p.interestPaid + p.interestRemaining).toBeCloseTo(rows.reduce((s, r) => s + r.interest, 0), 2);
    expect(loanPosition(rows, 10_000, "2024-12-01").theoreticalRemaining).toBe(10_000);
  });
});

describe("adjustmentAt", () => {
  const list = [
    { date: "2025-01-31", value: 1100, adjustment: 100 },
    { date: "2025-06-30", value: 1500, adjustment: 250 },
  ];
  it("aplica la última valoración anterior o igual a la fecha", () => {
    expect(adjustmentAt(list, "2025-01-30")).toBe(0);
    expect(adjustmentAt(list, "2025-01-31")).toBe(100);
    expect(adjustmentAt(list, "2025-06-29")).toBe(100);
    expect(adjustmentAt(list, "2026-01-01")).toBe(250);
    expect(adjustmentAt(undefined, "2026-01-01")).toBe(0);
  });
});
