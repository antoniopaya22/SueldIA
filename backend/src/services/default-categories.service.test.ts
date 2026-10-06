import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, planDefaultCategories } from "./default-categories.service.js";

describe("planDefaultCategories", () => {
  it("sin nada, crea todos los grupos con todas sus categorías", () => {
    const plan = planDefaultCategories([]);
    expect(plan.newGroups.map((g) => g.name)).toEqual(DEFAULT_CATEGORIES.map((d) => d.group));
    expect(plan.newGroups.map((g) => g.sortOrder)).toEqual(DEFAULT_CATEGORIES.map((_, i) => i));
    expect(plan.newCategories).toEqual([]);
  });

  it("no duplica un grupo que ya existe (aunque cambien mayúsculas o tildes) y completa lo que falta", () => {
    const plan = planDefaultCategories([
      { id: 7, name: "ALIMENTACION", sortOrder: 3, categoryNames: ["supermercado", "Mi categoría"] },
    ]);
    expect(plan.newGroups.map((g) => g.name)).not.toContain("Alimentación");
    expect(plan.newCategories.map((c) => c.name)).toEqual(["Restaurantes", "Café y bares"]);
    expect(plan.newCategories.every((c) => c.groupId === 7)).toBe(true);
    // Las nuevas se ordenan detrás de las que ya tenía.
    expect(plan.newCategories.map((c) => c.sortOrder)).toEqual([2, 3]);
  });

  it("los grupos nuevos van detrás de los existentes", () => {
    const plan = planDefaultCategories([{ id: 1, name: "Mis cosas", sortOrder: 4, categoryNames: [] }]);
    expect(plan.newGroups[0].sortOrder).toBe(5);
  });

  it("es idempotente: con todo ya creado no hay nada que hacer", () => {
    const all = DEFAULT_CATEGORIES.map((d, i) => ({ id: i + 1, name: d.group, sortOrder: i, categoryNames: d.categories }));
    expect(planDefaultCategories(all)).toEqual({ newGroups: [], newCategories: [] });
  });
});
