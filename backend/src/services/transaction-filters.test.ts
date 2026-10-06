import { describe, expect, it } from "vitest";
import { defaultCleared } from "./transaction-filters.js";

describe("defaultCleared", () => {
  it("liquida los movimientos de hoy o anteriores", () => {
    expect(defaultCleared("2025-03-10", "2025-03-10")).toBe(true);
    expect(defaultCleared("2025-01-01", "2025-03-10")).toBe(true);
  });

  it("deja pendientes los movimientos futuros", () => {
    expect(defaultCleared("2025-03-11", "2025-03-10")).toBe(false);
  });
});
