import { describe, expect, it } from "vitest";
import { activePeriod, monthRange, parseTxFilters, periodRange, transactionsHref } from "./transaction-filters";

describe("parseTxFilters / transactionsHref", () => {
  it("ida y vuelta por la URL", () => {
    const filters = { accountId: 2, categoryId: 7, from: "2026-01-01", to: "2026-01-31", cleared: "false" as const, minAmount: 10 };
    const href = transactionsHref(filters);
    expect(parseTxFilters(href.split("?")[1])).toEqual(filters);
  });

  it("ignora valores inválidos", () => {
    expect(parseTxFilters("cuenta=-1&tipo=otro&desde=2026-1-1&min=abc")).toEqual({});
  });
});

describe("periodos", () => {
  const today = new Date(2026, 10, 11); // 11 nov 2026, hora local
  it("monthRange incluye el último día real", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
  it("presets", () => {
    expect(periodRange("this-month", today)).toEqual({ from: "2026-11-01", to: "2026-11-11" });
    expect(periodRange("last-month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("year", today)).toEqual({ from: "2026-01-01", to: "2026-11-11" });
    expect(activePeriod("2026-10-01", "2026-10-31", today)).toBe("last-month");
    expect(activePeriod("2026-10-02", "2026-10-31", today)).toBeNull();
  });
});
