import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, categoryGroups } from "../db/schema.js";
import { normalizeText } from "../utils/text.js";

/* ───────── Categorías de partida ────────────────────────────────
 * Un punto de partida en español para quien empieza sin nada. Idempotente:
 * lo que ya existe (por nombre, sin tildes ni mayúsculas) no se duplica, así
 * que se puede pulsar dos veces o sobre unas categorías ya empezadas.
 */

export const DEFAULT_CATEGORIES: { group: string; categories: string[] }[] = [
  { group: "Vivienda", categories: ["Alquiler o hipoteca", "Comunidad", "Luz", "Agua", "Gas", "Internet y móvil", "Seguro del hogar"] },
  { group: "Alimentación", categories: ["Supermercado", "Restaurantes", "Café y bares"] },
  { group: "Transporte", categories: ["Gasolina", "Transporte público", "Parking y peajes", "Mantenimiento del coche"] },
  { group: "Salud", categories: ["Médico y farmacia", "Seguro de salud", "Deporte"] },
  { group: "Ocio", categories: ["Suscripciones", "Cine y eventos", "Viajes"] },
  { group: "Compras", categories: ["Ropa", "Tecnología", "Hogar"] },
  { group: "Finanzas", categories: ["Impuestos", "Comisiones bancarias"] },
  { group: "Otros", categories: ["Regalos", "Imprevistos"] },
];

export interface ExistingGroup {
  id: number;
  name: string;
  sortOrder: number;
  categoryNames: string[];
}

export interface DefaultsPlan {
  /** Grupos que faltan, con todas sus categorías. */
  newGroups: { name: string; sortOrder: number; categories: string[] }[];
  /** Categorías que faltan en grupos que el usuario ya tiene. */
  newCategories: { groupId: number; name: string; sortOrder: number }[];
}

/** Qué hay que crear para completar las categorías de partida sin duplicar nada (pura, probada). */
export function planDefaultCategories(existing: ExistingGroup[], defaults = DEFAULT_CATEGORIES): DefaultsPlan {
  const byName = new Map(existing.map((g) => [normalizeText(g.name), g]));
  const nextGroupOrder = existing.reduce((max, g) => Math.max(max, g.sortOrder), -1) + 1;
  const plan: DefaultsPlan = { newGroups: [], newCategories: [] };

  for (const def of defaults) {
    const group = byName.get(normalizeText(def.group));
    if (!group) {
      plan.newGroups.push({ name: def.group, sortOrder: nextGroupOrder + plan.newGroups.length, categories: def.categories });
      continue;
    }
    const have = new Set(group.categoryNames.map(normalizeText));
    def.categories
      .filter((name) => !have.has(normalizeText(name)))
      .forEach((name, i) => plan.newCategories.push({ groupId: group.id, name, sortOrder: group.categoryNames.length + i }));
  }
  return plan;
}

export async function seedDefaultCategories(userId: number): Promise<{ groups: number; categories: number }> {
  const [groupRows, categoryRows] = await Promise.all([
    db.select().from(categoryGroups).where(eq(categoryGroups.userId, userId)),
    db
      .select({ groupId: categories.groupId, name: categories.name })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(eq(categoryGroups.userId, userId)),
  ]);
  const plan = planDefaultCategories(
    groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      categoryNames: categoryRows.filter((c) => c.groupId === g.id).map((c) => c.name),
    })),
  );

  await db.transaction(async (tx) => {
    for (const group of plan.newGroups) {
      const [created] = await tx
        .insert(categoryGroups)
        .values({ userId, name: group.name, sortOrder: group.sortOrder })
        .returning({ id: categoryGroups.id });
      await tx
        .insert(categories)
        .values(group.categories.map((name, sortOrder) => ({ groupId: created.id, name, sortOrder })));
    }
    if (plan.newCategories.length > 0) await tx.insert(categories).values(plan.newCategories);
  });

  return {
    groups: plan.newGroups.length,
    categories: plan.newGroups.reduce((n, g) => n + g.categories.length, 0) + plan.newCategories.length,
  };
}
