import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("acepta rutas internas de la app", () => {
    expect(safeNextPath("/app/transactions?cuenta=2")).toBe("/app/transactions?cuenta=2");
    expect(safeNextPath(encodeURIComponent("/app/payslips?nomina=3"))).toBe("/app/payslips?nomina=3");
    expect(safeNextPath("/app")).toBe("/app");
  });
  it("rechaza lo que podría salir del sitio o de la app", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "/login", "/application", "javascript:alert(1)", "/app/../../evil", "%2F%2Fevil.com", null, ""]) {
      const r = safeNextPath(bad);
      expect(r.startsWith("/app"), String(bad)).toBe(true);
      expect(r.includes("evil"), String(bad)).toBe(false);
    }
  });
});
