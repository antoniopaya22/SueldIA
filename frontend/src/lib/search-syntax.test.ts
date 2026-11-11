import { describe, expect, it } from "vitest";
import { hasSyntax, parseSearchQuery } from "./search-syntax";

const TODAY = "2026-11-11";
const p = (q: string) => parseSearchQuery(q, TODAY);

describe("parseSearchQuery", () => {
  it("texto, importe mínimo y mes sin año (el último que ya ha pasado)", () => {
    expect(p("mercadona >50 oct")).toMatchObject({
      text: "mercadona", minAmount: 50, from: "2026-10-01", to: "2026-10-31", month: 10, year: 2026,
      chips: ["más de 50 €", "octubre 2026"],
    });
    // Diciembre aún no ha llegado en noviembre: el del año pasado.
    expect(p("dic")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("nóminas de un mes con año, con y sin «de»", () => {
    expect(p("nómina marzo 2025")).toMatchObject({ kind: "payslip", month: 3, year: 2025, text: "" });
    expect(p("nominas marzo de 2024")).toMatchObject({ kind: "payslip", month: 3, year: 2024 });
  });

  it("rangos e importes con coma, euro y signos", () => {
    expect(p("20-40")).toMatchObject({ minAmount: 20, maxAmount: 40 });
    expect(p("40-20")).toMatchObject({ minAmount: 20, maxAmount: 40 });
    expect(p("<12,5€")).toMatchObject({ maxAmount: 12.5 });
    expect(p("=9,99")).toMatchObject({ minAmount: 9.99, maxAmount: 9.99 });
    expect(p(">1.500")).toMatchObject({ minAmount: 1500 });
  });

  it("fechas relativas y tipo", () => {
    expect(p("gastos mes pasado")).toMatchObject({ kind: "expense", from: "2026-10-01", to: "2026-10-31" });
    expect(p("este mes")).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(p("ayer")).toMatchObject({ from: "2026-11-10", to: "2026-11-10" });
    expect(p("ingresos 2025")).toMatchObject({ kind: "income", from: "2025-01-01", to: "2025-12-31" });
    expect(p("enero 2026").from).toBe("2026-01-01");
    expect(p("mes pasado").chips).toEqual(["el mes pasado"]);
  });

  it("el texto normal se queda como texto", () => {
    const q = p("Bar Manolo");
    expect(q).toMatchObject({ text: "Bar Manolo", chips: [] });
    expect(hasSyntax(q)).toBe(false);
    // «mar» solo es marzo si va suelto: «mareas» es texto.
    expect(p("mareas").text).toBe("mareas");
  });
});
