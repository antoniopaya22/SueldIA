import { describe, expect, it } from "vitest";
import { FORMATS, detectFormat, matchConcepts, type PayslipFormat } from "./index.js";

const PUBLIC = ["NOTIFICACION  DE RETRIBUCIONES", "NOMINA MENSUAL, ENERO  Datos bancarios:", "SUELDO   1.200,00"].join("\n");
const PRIVATE = ["ACME S.L.", "PERIODO 01/03/2026 a 31/03/2026", "DEVENGOS", "SALARIO BASE   2.000,00", "DEDUCCIONES", "LIQUIDO A PERCIBIR  1.700,00"].join("\n");

describe("registro de formatos de nómina", () => {
  it("cada formato tiene un id único", () => {
    const ids = FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("elige el formato por confianza", () => {
    expect(detectFormat(PUBLIC).format.id).toBe("public-notification");
    expect(detectFormat(PRIVATE)).toMatchObject({ format: { id: "private-generic" }, confidence: 0.8 });
  });

  it("un texto que nadie reconoce cae en el formato de reserva", () => {
    expect(detectFormat("texto cualquiera")).toMatchObject({ format: { id: "private-generic" }, confidence: 0.2 });
  });

  it("matchConcepts anota el formato usado", () => {
    expect(matchConcepts(PUBLIC).format).toBe("public-notification");
    expect(matchConcepts(PRIVATE).format).toBe("private-generic");
  });

  it("un formato nuevo con más confianza se impone (así se añaden formatos)", () => {
    const custom: PayslipFormat = {
      id: "test-a3",
      label: "Prueba",
      detect: (t) => (t.includes("A3NOM") ? 0.9 : 0),
      parse: (rawText) => ({ periodMonth: 1, periodYear: 2026, company: null, grossSalary: null, netSalary: null, concepts: [], rawText }),
    };
    const formats = [custom, ...FORMATS];
    expect(detectFormat(`A3NOM\n${PRIVATE}`, formats).format.id).toBe("test-a3");
    expect(detectFormat(PRIVATE, formats).format.id).toBe("private-generic");
  });
});
