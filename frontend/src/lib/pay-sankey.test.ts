import { describe, expect, it } from "vitest";
import { buildPaySankey } from "./analytics-charts";

const inOut = (data: ReturnType<typeof buildPaySankey>, index: number) => ({
  in: data.links.filter((l) => l.target === index).reduce((s, l) => s + l.value, 0),
  out: data.links.filter((l) => l.source === index).reduce((s, l) => s + l.value, 0),
});

describe("buildPaySankey", () => {
  it("bruto → impuestos y neto → gastos y ahorro; el neto cuadra", () => {
    const d = buildPaySankey({ gross: 30_000, irpf: 4_500, otherDeductions: 1_900, net: 23_600 }, [
      { name: "Casa", total: 9_000 }, { name: "Comida", total: 4_000 },
    ], 5);
    expect(d.nodes.map((n) => n.name)).toEqual(["Bruto", "Neto", "Impuestos y cotizaciones", "IRPF", "Cotizaciones", "Casa", "Comida", "Ahorro"]);
    expect(inOut(d, 1)).toEqual({ in: 23_600, out: 23_600 });
    expect(inOut(d, 2)).toEqual({ in: 6_400, out: 6_400 });
    expect(d.links.find((l) => l.target === 7)?.value).toBe(10_600);
  });
  it("gastar más que el neto: la diferencia entra desde otros ingresos y ahorros", () => {
    const d = buildPaySankey({ gross: 20_000, irpf: 2_000, otherDeductions: 1_300, net: 16_700 }, [{ name: "Casa", total: 20_000 }], 5);
    expect(d.nodes.map((n) => n.name)).toContain("Otros ingresos y ahorros");
    const casa = d.nodes.findIndex((n) => n.name === "Casa");
    expect(inOut(d, casa).in).toBeCloseTo(20_000, 1);
    expect(d.nodes.some((n) => n.name === "Ahorro")).toBe(false);
  });
});
