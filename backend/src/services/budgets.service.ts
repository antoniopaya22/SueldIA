import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgets, categories, categoryGroups, transactions } from "../db/schema.js";
import { effectiveTransaction } from "./transaction-filters.js";

// Presupuesto simplificado estilo YNAB: "asignar lo que ya tienes". No es
// una réplica completa (sin cuentas fuera-de-presupuesto, sin "importe
// objetivo" por categoría, sin "edad del dinero") — solo lo esencial:
// cuánto queda por asignar, y cuánto queda disponible en cada categoría
// arrastrando el sobrante (o el desfase) de meses anteriores.

export interface CategoryBudget {
  id: number;
  name: string;
  assigned: number;
  activity: number;
  available: number;
}

export interface CategoryGroupBudget {
  id: number;
  name: string;
  categories: CategoryBudget[];
}

export interface BudgetSummary {
  month: string;
  readyToAssign: number;
  groups: CategoryGroupBudget[];
}

// Comparación léxica sobre fechas ISO en texto: "YYYY-MM-31" es mayor que
// cualquier fecha real de ese mes (28/29/30/31), así que sirve como límite
// superior inclusivo sin tener que calcular el último día real del mes —
// mismo truco que ya se usa en dashboard.service.ts/transactions.ts.
function monthEndBoundary(month: string): string {
  return `${month}-31`;
}

// Solo los gastos son "actividad" de una categoría. Los ingresos ya entran
// completos en "Para presupuestar" (ver getBudgetSummary): contarlos también
// aquí los duplicaría (inflaba el disponible de la categoría y el total).
// Un reembolso categorizado cuenta, por tanto, como ingreso a presupuestar.
const activityExpr = sql<number>`sum(case when ${transactions.type} = 'expense' then -${transactions.amount} else 0 end)`;

/** Suma de `assigned`, por categoría, de las filas de budgets de este usuario hasta (e incluyendo) `throughMonth`. */
async function assignedByCategory(userId: number, throughMonth: string, exactMonth?: string) {
  const rows = await db
    .select({ categoryId: budgets.categoryId, total: sql<number>`coalesce(sum(${budgets.assigned}), 0)` })
    .from(budgets)
    .innerJoin(categories, eq(budgets.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        eq(categoryGroups.userId, userId),
        exactMonth ? eq(budgets.month, exactMonth) : lte(budgets.month, throughMonth),
      ),
    )
    .groupBy(budgets.categoryId);
  return new Map(rows.map((r) => [r.categoryId, Number(r.total)]));
}

/** Suma de actividad (gasto en negativo), por categoría, solo movimientos liquidados, hasta `endDate` inclusive (o dentro de un rango si se da `startDate`). */
async function activityByCategory(userId: number, endDate: string, startDate?: string) {
  const conditions = [
    eq(transactions.userId, userId),
    effectiveTransaction(),
    sql`${transactions.categoryId} is not null`,
    lte(transactions.date, endDate),
  ];
  if (startDate) conditions.push(gte(transactions.date, startDate));

  const rows = await db
    .select({ categoryId: transactions.categoryId, total: activityExpr })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.categoryId);
  return new Map(rows.map((r) => [r.categoryId as number, Number(r.total)]));
}

export async function getBudgetSummary(userId: number, month: string): Promise<BudgetSummary> {
  const endOfMonth = monthEndBoundary(month);
  const startOfMonth = `${month}-01`;

  const [groupRows, catRows, assignedThisMonth, cumulativeAssigned, activityThisMonth, cumulativeActivity, incomeRow] =
    await Promise.all([
      db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.userId, userId))
        .orderBy(categoryGroups.sortOrder, categoryGroups.name),
      db
        .select({ category: categories })
        .from(categories)
        .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
        .where(eq(categoryGroups.userId, userId))
        .orderBy(categories.sortOrder, categories.name),
      assignedByCategory(userId, month, month),
      assignedByCategory(userId, month),
      activityByCategory(userId, endOfMonth, startOfMonth),
      activityByCategory(userId, endOfMonth),
      db
        .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            effectiveTransaction(),
            eq(transactions.type, "income"),
            lte(transactions.date, endOfMonth),
          ),
        ),
    ]);

  return assembleBudgetSummary({
    month,
    groupRows,
    catRows: catRows.map((r) => r.category),
    assignedThisMonth,
    cumulativeAssigned,
    activityThisMonth,
    cumulativeActivity,
    incomeThroughMonth: Number(incomeRow[0]?.total ?? 0),
  });
}

export interface BudgetSummaryInputs {
  month: string;
  groupRows: { id: number; name: string }[];
  catRows: { id: number; groupId: number; name: string }[];
  assignedThisMonth: Map<number, number>;
  cumulativeAssigned: Map<number, number>;
  /** Gasto del mes por categoría, en negativo. */
  activityThisMonth: Map<number, number>;
  cumulativeActivity: Map<number, number>;
  incomeThroughMonth: number;
}

/** Parte pura de getBudgetSummary (sin base de datos), separada para poder probarla. */
export function assembleBudgetSummary(input: BudgetSummaryInputs): BudgetSummary {
  const categoriesByGroup = new Map<number, CategoryBudget[]>();
  for (const c of input.catRows) {
    const available = (input.cumulativeAssigned.get(c.id) ?? 0) + (input.cumulativeActivity.get(c.id) ?? 0);
    const entry: CategoryBudget = {
      id: c.id,
      name: c.name,
      assigned: input.assignedThisMonth.get(c.id) ?? 0,
      activity: input.activityThisMonth.get(c.id) ?? 0,
      available: Math.round(available * 100) / 100,
    };
    const list = categoriesByGroup.get(c.groupId) ?? [];
    list.push(entry);
    categoriesByGroup.set(c.groupId, list);
  }

  const groups: CategoryGroupBudget[] = input.groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    categories: categoriesByGroup.get(g.id) ?? [],
  }));

  // "Para presupuestar" = todo lo ingresado hasta este mes, menos todo lo
  // asignado hasta este mes (a cualquier categoría) — arrastra de un mes a
  // otro igual que "available", así que no hace falta guardar un saldo aparte.
  const totalAssignedThroughMonth = [...input.cumulativeAssigned.values()].reduce((s, v) => s + v, 0);
  const readyToAssign = input.incomeThroughMonth - totalAssignedThroughMonth;

  return {
    month: input.month,
    readyToAssign: Math.round(readyToAssign * 100) / 100,
    groups,
  };
}

export async function categoryBelongsToUser(userId: number, categoryId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(categories.id, categoryId), eq(categoryGroups.userId, userId)));
  return !!row;
}

export async function upsertBudget(userId: number, categoryId: number, month: string, assigned: number) {
  const [row] = await db
    .insert(budgets)
    .values({ userId, categoryId, month, assigned })
    .onConflictDoUpdate({
      target: [budgets.categoryId, budgets.month],
      set: { assigned },
    })
    .returning();
  return row;
}
