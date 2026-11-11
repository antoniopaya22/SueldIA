import { describe, expect, it } from "vitest";
import { currentMonthKey, isoDateSchema, isValidIsoDate, isValidMonthKey, monthKeySchema, todayIso } from "./dates.js";

describe("todayIso", () => {
  it("usa la hora de Madrid, no UTC", () => {
    // 23:30 UTC del 31 de enero = 00:30 del 1 de febrero en Madrid (UTC+1).
    expect(todayIso(new Date("2026-01-31T23:30:00Z"))).toBe("2026-02-01");
    expect(currentMonthKey(new Date("2026-01-31T23:30:00Z"))).toBe("2026-02");
    // En verano (UTC+2): 22:30 UTC del 30 de junio = 00:30 del 1 de julio.
    expect(todayIso(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(todayIso(new Date("2026-06-30T21:30:00Z"))).toBe("2026-06-30");
  });
});

describe("isValidIsoDate", () => {
  it("acepta fechas reales", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-12-31")).toBe(true);
  });
  it("rechaza fechas que no existen o mal formadas", () => {
    for (const v of ["2025-02-29", "2025-02-32", "2025-13-01", "2025-00-10", "2025-04-31", "2025-1-01", "20250101", "0000-01-01", ""]) {
      expect(isValidIsoDate(v), v).toBe(false);
    }
  });
  it("funciona como esquema Zod", () => {
    expect(isoDateSchema.safeParse("2025-02-32").success).toBe(false);
    expect(isoDateSchema.safeParse("2025-02-28").success).toBe(true);
  });
});

describe("isValidMonthKey", () => {
  it("valida el mes", () => {
    expect(isValidMonthKey("2025-01")).toBe(true);
    expect(isValidMonthKey("2025-12")).toBe(true);
    expect(isValidMonthKey("2025-13")).toBe(false);
    expect(isValidMonthKey("2025-00")).toBe(false);
    expect(monthKeySchema.safeParse("2025-13").success).toBe(false);
  });
});
