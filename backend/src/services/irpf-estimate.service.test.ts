import { describe, expect, it } from "vitest";
import { estimateAnnualIrpf, irpfEstimate, scaleTax } from "./irpf-estimate.service.js";

describe("estimación de IRPF (aproximada)", () => {
  it("escala por tramos", () => {
    expect(scaleTax(12_450)).toBeCloseTo(2365.5, 2);
    expect(scaleTax(20_200)).toBeCloseTo(2365.5 + 7750 * 0.24, 2);
    expect(scaleTax(0)).toBe(0);
  });
  it("sueldos bajos no tributan (reducción por rendimientos del trabajo)", () => {
    expect(estimateAnnualIrpf(15_000, 950).tax).toBe(0);
  });
  it("un sueldo medio: tipo efectivo razonable", () => {
    const r = estimateAnnualIrpf(30_000, 1_905);
    // base = 30000 − 1905 − 2000 = 26095 → cuota ≈ 6.100 − 1.054,5
    expect(r.base).toBe(26_095);
    expect(r.effectiveRate).toBeGreaterThan(15);
    expect(r.effectiveRate).toBeLessThan(18);
  });
  it("proyecta al año y dice si la retención va corta o larga", () => {
    // 6 meses de 2.500 € brutos con un 10 % de retención: va corta.
    const short = irpfEstimate({ grossTotal: 15_000, irpfWithheld: 1_500, socialSecurity: 952.5 }, 6)!;
    expect(short).toMatchObject({ projectedGross: 30_000, projectedWithheld: 3_000, verdict: "short", complete: false });
    expect(short.difference).toBeGreaterThan(1_500);
    // Con un 25 % retenido: va larga (a devolver).
    expect(irpfEstimate({ grossTotal: 15_000, irpfWithheld: 3_750, socialSecurity: 952.5 }, 6)!.verdict).toBe("long");
    // Menos de 3 meses: no se estima.
    expect(irpfEstimate({ grossTotal: 5_000, irpfWithheld: 500, socialSecurity: 300 }, 2)).toBeNull();
  });
});
