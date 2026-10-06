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
