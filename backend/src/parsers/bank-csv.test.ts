import { describe, expect, it } from "vitest";
import { decodeCsv, detectDelimiter, guessMapping, parseAmount, parseBankCsv, parseDate, splitCsv, splitCsvLine } from "./bank-csv.js";

describe("lectura de CSV", () => {
  it("respeta comillas y separadores dentro de ellas", () => {
    expect(splitCsvLine('"01/03/2026";"MERCADONA; S.A.";"-12,50"', ";")).toEqual(["01/03/2026", "MERCADONA; S.A.", "-12,50"]);
    expect(splitCsvLine('a,"di ""hola""",c', ",")).toEqual(["a", 'di "hola"', "c"]);
  });
  it("detecta el separador", () => {
    expect(detectDelimiter("Fecha;Concepto;Importe\n01/03/2026;Pan;-1,20")).toBe(";");
    expect(detectDelimiter("Date,Description,Amount\n2026-03-01,Bread,-1.20")).toBe(",");
    expect(detectDelimiter("Fecha\tConcepto\tImporte\n01/03/2026\tPan\t-1,20")).toBe("\t");
  });
  it("decodifica Windows-1252 cuando no es UTF-8", () => {
    const latin1 = new Uint8Array([0x4e, 0xf3, 0x6d, 0x69, 0x6e, 0x61]); // "Nómina" en Windows-1252
    expect(decodeCsv(latin1)).toBe("Nómina");
    expect(decodeCsv(new TextEncoder().encode("﻿Nómina"))).toBe("Nómina");
  });
});

describe("importes y fechas", () => {
  it.each([
    ["-1.234,56", "comma", -1234.56],
    ["1.234,56 €", "comma", 1234.56],
    ["12,50-", "comma", -12.5],
    ["(12,50)", "comma", -12.5],
    ["+3,00", "comma", 3],
    ["-1,234.56", "dot", -1234.56],
    ["abc", "comma", null],
    ["", "comma", null],
  ] as const)("%s (%s) → %s", (raw, dec, expected) => {
    expect(parseAmount(raw, dec)).toBe(expected);
  });
  it("fechas en los formatos habituales", () => {
    expect(parseDate("01/03/2026", "DD/MM/YYYY")).toBe("2026-03-01");
    expect(parseDate("1-3-26", "DD/MM/YYYY")).toBe("2026-03-01");
    expect(parseDate("2026-03-01 10:22", "YYYY-MM-DD")).toBe("2026-03-01");
    expect(parseDate("03/25/2026", "MM/DD/YYYY")).toBe("2026-03-25");
    expect(parseDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
  });
});

describe("parseBankCsv", () => {
  const csv = [
    "Fecha operación;Fecha valor;Concepto;Importe;Saldo",
    "01/03/2026;01/03/2026;MERCADONA;-45,30;1.954,70",
    "02/03/2026;02/03/2026;NOMINA ACME;2.000,00;3.954,70",
    "02/03/2026;02/03/2026;COMISION;0,00;3.954,70",
    "33/03/2026;;MAL;-1,00;",
    "Saldo final;;;;3.954,70",
  ].join("\n");

  it("propone el mapeo y lee las filas", () => {
    const lines = splitCsv(csv, ";");
    const mapping = guessMapping(lines[0], lines[1], ";");
    expect(mapping).toMatchObject({ dateColumn: 0, payeeColumn: 2, amountColumn: 3, decimal: "comma", dateFormat: "DD/MM/YYYY" });
    const result = parseBankCsv(csv, mapping);
    expect(result.rows).toEqual([
      { line: 2, date: "2026-03-01", payee: "MERCADONA", memo: "", amount: -45.3 },
      { line: 3, date: "2026-03-02", payee: "NOMINA ACME", memo: "", amount: 2000 },
    ]);
    // La fila con fecha imposible se informa; el pie «Saldo final» se ignora sin error.
    expect(result.errors).toEqual([{ line: 5, reason: "Fecha no válida: «33/03/2026»" }]);
  });

  it("columnas de cargo y abono", () => {
    const text = "Fecha;Descripción;Cargo;Abono\n01/03/2026;Luz;54,10;\n05/03/2026;Bizum;;20,00";
    const lines = splitCsv(text, ";");
    const mapping = guessMapping(lines[0], lines[1], ";");
    expect(mapping).toMatchObject({ amountColumn: null, debitColumn: 2, creditColumn: 3 });
    expect(parseBankCsv(text, mapping).rows.map((r) => r.amount)).toEqual([-54.1, 20]);
  });
});

describe("findHeaderIndex", () => {
  it("salta las líneas de título del banco", async () => {
    const { findHeaderIndex } = await import("./bank-csv.js");
    const text = "Movimientos de la cuenta ES12;;;;\nTitular: ANA;;;;\nFecha;Valor;Concepto;Importe;Saldo\n03/11/2026;03/11/2026;PAN;-1,20;10,00";
    expect(findHeaderIndex(splitCsv(text, ";"))).toBe(2);
    expect(findHeaderIndex(splitCsv("Fecha;Concepto;Importe\n01/01/2026;X;1", ";"))).toBe(0);
  });
});
