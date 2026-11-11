import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv.js";

describe("csvCell", () => {
  it("neutraliza fórmulas en textos", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+34 600")).toBe("'+34 600");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("no toca números negativos reales", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
  });
  it("entrecomilla comas, comillas y saltos (también \\r)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("di \"hola\"")).toBe('"di ""hola"""');
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });
  it("fechas como YYYY-MM-DD y vacíos como celda vacía", () => {
    expect(csvCell(new Date("2026-11-11T10:00:00Z"))).toBe("2026-11-11");
    expect(csvCell(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("cabecera aunque no haya filas", () => {
    expect(toCsv(["Fecha", "Importe"], [])).toBe("﻿Fecha,Importe");
  });
  it("filas en el orden de la cabecera", () => {
    expect(toCsv(["A", "B"] as const, [{ B: 2, A: "x" }])).toBe("﻿A,B\nx,2");
  });
});
