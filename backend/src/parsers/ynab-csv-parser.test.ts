import { describe, expect, it } from "vitest";
import { parseYnabCsv } from "./ynab-csv-parser.js";

const q = (v: string) => `"${v}"`;

function row(clearedStatus: string): string {
  return [
    q("Cuenta"), q(""), q("10/03/2025"), q("Mercadona"), q("Hogar/Supermercado"),
    q("Hogar"), q("Supermercado"), q(""), q("12,50€"), q("0,00€"), q(clearedStatus),
  ].join("\t");
}

describe("parseYnabCsv · estado liquidado", () => {
  it.each([
    ["Cleared", true],
    ["Reconciled", true],
    ["Uncleared", false],
  ])("«%s» → cleared=%s", (status, expected) => {
    const csv = ["cabecera", row(status)].join("\n");
    expect(parseYnabCsv(csv).rows[0].cleared).toBe(expected);
  });
});

describe("parseYnabCsv · fechas", () => {
  const withDate = (date: string) => row("Cleared").replace(q("10/03/2025"), q(date));

  it("no marca fechas válidas", () => {
    expect(parseYnabCsv(["cabecera", row("Cleared")].join("\n")).invalidDateLines).toEqual([]);
  });

  it("marca la fila de fechas que no existen o en formato US", () => {
    const csv = ["cabecera", row("Cleared"), withDate("12/25/2024"), withDate("31/02/2025"), withDate("2025-03-10")].join("\n");
    // La ISO ya válida (última fila) se acepta tal cual.
    expect(parseYnabCsv(csv).invalidDateLines).toEqual([3, 4]);
  });
});
