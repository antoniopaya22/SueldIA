import { describe, expect, it } from "vitest";
import {
  getNextOccurrenceDate,
  getOccurrenceDate,
  listOccurrenceDates,
  shouldAutoSettle,
  summarizePending,
} from "./recurring-transactions.service.js";

describe("recurring transactions schedule helpers", () => {
  it("preserves end-of-month cadence for monthly schedules", () => {
    const schedule = {
      startDate: "2026-01-31",
      endDate: null,
      cadence: "monthly" as const,
      intervalCount: 1,
    };

    expect(getOccurrenceDate(schedule, 0)).toBe("2026-01-31");
    expect(getOccurrenceDate(schedule, 1)).toBe("2026-02-28");
    expect(getOccurrenceDate(schedule, 2)).toBe("2026-03-31");
  });

  it("returns the next future occurrence from a reference date", () => {
    const schedule = {
      startDate: "2026-03-15",
      endDate: null,
      cadence: "monthly" as const,
      intervalCount: 1,
    };

    expect(getNextOccurrenceDate(schedule, "2026-04-02")).toBe("2026-04-15");
  });

  it("stops occurrence generation at the configured end date", () => {
    const schedule = {
      startDate: "2026-04-01",
      endDate: "2026-06-01",
      cadence: "monthly" as const,
      intervalCount: 1,
    };

    expect(listOccurrenceDates(schedule, "2026-12-31")).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
    ]);
  });
});
describe("shouldAutoSettle", () => {
  it("solo las domiciliaciones, y solo cuando ya ha llegado el día", () => {
    expect(shouldAutoSettle({ autoSettle: true }, "2025-03-10", "2025-03-10")).toBe(true);
    expect(shouldAutoSettle({ autoSettle: true }, "2025-03-01", "2025-03-10")).toBe(true);
    expect(shouldAutoSettle({ autoSettle: true }, "2025-03-11", "2025-03-10")).toBe(false);
    expect(shouldAutoSettle({ autoSettle: false }, "2025-03-01", "2025-03-10")).toBe(false);
  });
});

describe("summarizePending", () => {
  it("separa lo vencido de lo futuro por regla", () => {
    const summary = summarizePending(
      [
        { recurringTransactionId: 1, date: "2025-03-01" },
        { recurringTransactionId: 1, date: "2025-03-10" },   // hoy: vencida
        { recurringTransactionId: 1, date: "2025-03-20" },   // futura
        { recurringTransactionId: 2, date: "2025-04-01" },
        { recurringTransactionId: null, date: "2025-03-02" }, // no viene de una regla
      ],
      "2025-03-10",
    );
    expect(summary.get(1)).toEqual({ pending: 3, overdue: 2 });
    expect(summary.get(2)).toEqual({ pending: 1, overdue: 0 });
    expect(summary.size).toBe(2);
  });
});
