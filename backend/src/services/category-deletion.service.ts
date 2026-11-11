import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  budgets, categories, categoryGroups, categoryRules, categoryTargets, recurringTransactions, transactions,
} from "../db/schema.js";

// Borrar una categoría (o un grupo, con todas las suyas) arrastraba en silencio
// mucho más de lo que el diálogo decía: los movimientos quedaban sin categoría
// —y su gasto dejaba de descontar del presupuesto, que se descuadraba—, y se
// borraban asignaciones, objetivos y reglas. Aquí se calcula ese alcance para
// enseñarlo antes, y se ofrece mover todo a otra categoría en vez de perderlo.

export interface CategoryUsage {
  transactions: number;
  recurring: number;
  budgetMonths: number;
  rules: number;
  targets: number;
}

/** Ids de las categorías del grupo, solo si el grupo es del usuario (null si no). */
export async function ownedGroupCategoryIds(userId: number, groupId: number): Promise<number[] | null> {
  const [group] = await db
    .select({ id: categoryGroups.id })
    .from(categoryGroups)
    .where(and(eq(categoryGroups.id, groupId), eq(categoryGroups.userId, userId)));
  if (!group) return null;
  const rows = await db.select({ id: categories.id }).from(categories).where(eq(categories.groupId, groupId));
  return rows.map((r) => r.id);
}

/** Grupo de la categoría, solo si es del usuario (null si no existe o es ajena). */
export async function ownedCategoryGroupId(userId: number, categoryId: number): Promise<number | null> {
  const [row] = await db
    .select({ groupId: categories.groupId })
    .from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(categories.id, categoryId), eq(categoryGroups.userId, userId)));
  return row?.groupId ?? null;
}

export async function getCategoryUsage(userId: number, categoryIds: number[]): Promise<CategoryUsage> {
  if (categoryIds.length === 0) return { transactions: 0, recurring: 0, budgetMonths: 0, rules: 0, targets: 0 };
  const count = sql<number>`count(*)::int`;
  const [[tx], [rec], [bud], [rul], [tar]] = await Promise.all([
    db.select({ n: count }).from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.categoryId, categoryIds))),
    db.select({ n: count }).from(recurringTransactions)
      .where(and(eq(recurringTransactions.userId, userId), inArray(recurringTransactions.categoryId, categoryIds))),
    // Meses con algo asignado (una fila a 0 no es información que se pierda).
    db.select({ n: sql<number>`count(distinct ${budgets.month})::int` }).from(budgets)
      .where(and(eq(budgets.userId, userId), inArray(budgets.categoryId, categoryIds), sql`${budgets.assigned} <> 0`)),
    db.select({ n: count }).from(categoryRules)
      .where(and(eq(categoryRules.userId, userId), inArray(categoryRules.categoryId, categoryIds))),
    db.select({ n: count }).from(categoryTargets)
      .where(and(eq(categoryTargets.userId, userId), inArray(categoryTargets.categoryId, categoryIds))),
  ]);
  return { transactions: tx.n, recurring: rec.n, budgetMonths: bud.n, rules: rul.n, targets: tar.n };
}

/**
 * Borra las categorías indicadas (ya comprobado que son del usuario). Con
 * `reassignTo`, antes mueve a esa categoría sus movimientos, recurrentes,
 * reglas y lo asignado en el presupuesto (sumándolo a lo que ya tuviera ese
 * mes). Los objetivos no se mueven: la categoría destino puede tener el suyo.
 * `deleteGroupId`: además borra ese grupo (las categorías caen en cascada).
 */
export async function deleteCategories(
  userId: number,
  categoryIds: number[],
  reassignTo: number | null,
  deleteGroupId?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (reassignTo !== null && categoryIds.length > 0) {
      await tx.update(transactions).set({ categoryId: reassignTo })
        .where(and(eq(transactions.userId, userId), inArray(transactions.categoryId, categoryIds)));
      await tx.update(recurringTransactions).set({ categoryId: reassignTo })
        .where(and(eq(recurringTransactions.userId, userId), inArray(recurringTransactions.categoryId, categoryIds)));
      await tx.update(categoryRules).set({ categoryId: reassignTo })
        .where(and(eq(categoryRules.userId, userId), inArray(categoryRules.categoryId, categoryIds)));
      await tx.execute(sql`
        INSERT INTO ${budgets} (user_id, category_id, month, assigned)
        SELECT ${userId}, ${reassignTo}, month, SUM(assigned)
        FROM ${budgets}
        WHERE user_id = ${userId} AND category_id IN (${sql.join(categoryIds.map((id) => sql`${id}`), sql`, `)})
        GROUP BY month
        ON CONFLICT (category_id, month) DO UPDATE SET assigned = ${budgets}.assigned + excluded.assigned
      `);
    }

    if (deleteGroupId !== undefined) {
      await tx.delete(categoryGroups)
        .where(and(eq(categoryGroups.id, deleteGroupId), eq(categoryGroups.userId, userId)));
    } else if (categoryIds.length > 0) {
      await tx.delete(categories).where(inArray(categories.id, categoryIds));
    }
  });
}
