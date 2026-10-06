import { describe, expect, it } from "vitest";
import { buildPayeeHistory, findRuleCategory, pickHistoryCategory } from "./category-rules.service.js";

describe("findRuleCategory", () => {
  const rules = [
    { match: "mercadona", categoryId: 1 },
    { match: "mercadona valencia", categoryId: 2 },
    { match: "amazon", categoryId: 3 },
    { match: "cafe", categoryId: 4 },
  ];

  it("encaja si el beneficiario contiene el texto de la regla", () => {
    expect(findRuleCategory("MERCADONA Alicante", rules)).toBe(1);
    expect(findRuleCategory("Pago Amazon Prime", rules)).toBe(3);
  });

  it("gana la regla más específica (el texto más largo)", () => {
    expect(findRuleCategory("Mercadona Valencia centro", rules)).toBe(2);
  });

  it("ignora tildes y mayúsculas", () => {
    expect(findRuleCategory("Café Ñandú", rules)).toBe(4);
  });

  it("null si nada encaja o no hay beneficiario", () => {
    expect(findRuleCategory("Carrefour", rules)).toBeNull();
    expect(findRuleCategory("", rules)).toBeNull();
    expect(findRuleCategory(null, rules)).toBeNull();
    expect(findRuleCategory("Mercadona", [])).toBeNull();
  });
});

describe("pickHistoryCategory", () => {
  const history = buildPayeeHistory([
    { type: "expense", payee: "mercadona", categoryId: 1, n: 8 },
    { type: "expense", payee: "Mercadona ", categoryId: 5, n: 2 }, // misma tienda, otra grafía
    { type: "expense", payee: "mercadona", categoryId: 6, n: 1 },
    { type: "income", payee: "mercadona", categoryId: 9, n: 1 },    // un reembolso: otro tipo
  ]);

  it("elige la categoría más usada con ese beneficiario", () => {
    expect(pickHistoryCategory("expense", "MERCADONA", history)).toBe(1);
  });

  it("no mezcla gastos con ingresos", () => {
    expect(pickHistoryCategory("income", "Mercadona", history)).toBe(9);
  });

  it("null si nunca se categorizó", () => {
    expect(pickHistoryCategory("expense", "Carrefour", history)).toBeNull();
    expect(pickHistoryCategory("expense", "", history)).toBeNull();
  });
});
