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

describe("reglas con condiciones", () => {
  it("todas las condiciones deben cumplirse y gana la más específica", async () => {
    const { findRuleFor, ruleMatches } = await import("./category-rules.service.js");
    const rules = [
      { match: "amazon", categoryId: 1 },
      { match: "amazon", categoryId: 2, transactionType: "expense" as const, minAmount: 50 },
      { match: "seguro", categoryId: 3, matchField: "memo" as const },
      { match: "bizum", categoryId: 4, accountId: 7 },
    ];
    expect(findRuleFor({ payee: "AMAZON EU", type: "expense", amount: 20 }, rules)).toBe(1);
    expect(findRuleFor({ payee: "AMAZON EU", type: "expense", amount: 80 }, rules)).toBe(2);
    expect(findRuleFor({ payee: "Mapfre", memo: "Seguro del coche" }, rules)).toBe(3);
    expect(findRuleFor({ payee: "Bizum Juan", accountId: 8 }, rules)).toBeNull();
    expect(findRuleFor({ payee: "Bizum Juan", accountId: 7 }, rules)).toBe(4);
    // Sin el dato, la condición no se cumple (no se aplica a ciegas).
    expect(ruleMatches(rules[1], { payee: "Amazon" })).toBe(false);
  });
});
