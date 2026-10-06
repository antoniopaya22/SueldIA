import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { budgets, categories, categoryGroups, categoryTargets, transactions } from "../db/schema.js";
import { effectiveTransaction } from "./transaction-filters.js";

// Presupuesto simplificado estilo YNAB: "asignar lo que ya tienes". No es
// una réplica completa (sin cuentas fuera-de-presupuesto, sin "importe
// objetivo" por categoría, sin "edad del dinero") — solo lo esencial:
// cuánto queda por asignar, y cuánto queda disponible en cada categoría
// arrastrando el sobrante (o el desfase) de meses anteriores.

export type TargetType = "monthly" | "by_date";

export interface TargetInput {
  type: TargetType;
  amount: number;
  /** "YYYY-MM"; solo en objetivos by_date. */
  targetMonth: string | null;
}

export interface CategoryTarget extends TargetInput {
  /** Lo que habría que asignar este mes para ir según el objetivo. */
  needed: number;
  /** Lo que falta asignar este mes (needed − asignado, nunca negativo). */
  shortfall: number;
  funded: boolean;
}

export interface CategoryBudget {
  id: number;
  name: string;
  assigned: number;
  /** Gasto del mes en negativo (ver activityExpr). */
  activity: number;
  available: number;
  /** Lo que ya había disponible al empezar el mes (arrastre de meses anteriores). */
  carryIn: number;
  target: CategoryTarget | null;
}

export interface CategoryGroupBudget {
  id: number;
  name: string;
  categories: CategoryBudget[];
}

export interface BudgetSummary {
  month: string;
  readyToAssign: number;
  /** Suma de lo que falta asignar este mes para cumplir todos los objetivos. */
  targetsShortfall: number;
  groups: CategoryGroupBudget[];
}

// ─── Cálculos puros (sin base de datos, probados en budgets.service.test.ts) ──

const roundCents = (n: number) => Math.round(n * 100) / 100;
// El epsilon evita que 0.1+0.2 (=0.30000000000000004) suba un céntimo de más.
const ceilCents = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/** "2025-03" desplazado `delta` meses. */
export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const abs = y * 12 + (m - 1) + delta;
  return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}`;
}

/** Meses entre dos claves "YYYY-MM" (to − from; negativo si `to` es anterior). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Estado de un objetivo en un mes:
 *  - monthly: hay que asignar `amount` este mes.
 *  - by_date: lo que falta por llegar a `amount` (descontado lo que ya había
 *    al empezar el mes) se reparte entre los meses que quedan hasta la fecha,
 *    este incluido; pasada la fecha, se pide todo de golpe.
 */
export function evaluateTarget(
  target: TargetInput,
  ctx: { month: string; carryIn: number; assigned: number },
): CategoryTarget {
  let needed: number;
  if (target.type === "monthly") {
    needed = target.amount;
  } else {
    const monthsLeft = Math.max(1, monthsBetween(ctx.month, target.targetMonth ?? ctx.month) + 1);
    const remaining = target.amount - ctx.carryIn;
    needed = remaining <= 0 ? 0 : ceilCents(remaining / monthsLeft);
  }
  const shortfall = Math.max(0, roundCents(needed - ctx.assigned));
  return { ...target, needed: roundCents(needed), shortfall, funded: shortfall === 0 };
}

/**
 * Qué asignar al "rellenar" desde una propuesta (mes anterior, media…):
 * solo categorías sin nada asignado este mes — nunca pisa lo que el usuario ya
 * decidió — y solo importes positivos.
 */
export function planFill(
  proposals: Map<number, number>,
  currentAssigned: Map<number, number>,
): Map<number, number> {
  const plan = new Map<number, number>();
  for (const [categoryId, amount] of proposals) {
    const value = roundCents(amount);
    if (value > 0 && (currentAssigned.get(categoryId) ?? 0) === 0) plan.set(categoryId, value);
  }
  return plan;
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

  const [groupRows, catRows, assignedThisMonth, cumulativeAssigned, activityThisMonth, cumulativeActivity, incomeRow, targetRows] =
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
      db.select().from(categoryTargets).where(eq(categoryTargets.userId, userId)),
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
    targets: new Map(
      targetRows.map((t) => [t.categoryId, { type: t.type, amount: t.amount, targetMonth: t.targetMonth }]),
    ),
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
  /** Objetivos por categoría; opcional (sin él, ninguna categoría tiene objetivo). */
  targets?: Map<number, TargetInput>;
}

/** Parte pura de getBudgetSummary (sin base de datos), separada para poder probarla. */
export function assembleBudgetSummary(input: BudgetSummaryInputs): BudgetSummary {
  const categoriesByGroup = new Map<number, CategoryBudget[]>();
  for (const c of input.catRows) {
    const available = (input.cumulativeAssigned.get(c.id) ?? 0) + (input.cumulativeActivity.get(c.id) ?? 0);
    const assigned = input.assignedThisMonth.get(c.id) ?? 0;
    const activity = input.activityThisMonth.get(c.id) ?? 0;
    // disponible = arrastre + asignado este mes + actividad (en negativo) de este mes.
    const carryIn = roundCents(available - assigned - activity);
    const targetInput = input.targets?.get(c.id);
    const entry: CategoryBudget = {
      id: c.id,
      name: c.name,
      assigned,
      activity,
      available: roundCents(available),
      carryIn,
      target: targetInput ? evaluateTarget(targetInput, { month: input.month, carryIn, assigned }) : null,
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

  const targetsShortfall = groups
    .flatMap((g) => g.categories)
    .reduce((sum, c) => sum + (c.target?.shortfall ?? 0), 0);

  return {
    month: input.month,
    readyToAssign: Math.round(readyToAssign * 100) / 100,
    targetsShortfall: roundCents(targetsShortfall),
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

// ─── Objetivos ──────────────────────────────────────────────────

export async function upsertTarget(userId: number, categoryId: number, input: TargetInput) {
  const [row] = await db
    .insert(categoryTargets)
    .values({ userId, categoryId, ...input })
    .onConflictDoUpdate({
      target: categoryTargets.categoryId,
      set: { type: input.type, amount: input.amount, targetMonth: input.targetMonth },
    })
    .returning();
  return row;
}

export async function deleteTarget(userId: number, categoryId: number): Promise<boolean> {
  const rows = await db
    .delete(categoryTargets)
    .where(and(eq(categoryTargets.userId, userId), eq(categoryTargets.categoryId, categoryId)))
    .returning({ id: categoryTargets.id });
  return rows.length > 0;
}

// ─── Asignación rápida ──────────────────────────────────────────

export type AutoAssignMode = "copy-previous" | "average-3" | "targets";

export interface AutoAssignResult {
  /** Categorías a las que se asignó algo. */
  categories: number;
  /** Importe añadido en total (lo que sube lo asignado, no el nuevo asignado). */
  total: number;
}

async function writeAssignments(userId: number, month: string, plan: Map<number, number>) {
  if (plan.size === 0) return;
  await db.transaction(async (tx) => {
    for (const [categoryId, assigned] of plan) {
      await tx
        .insert(budgets)
        .values({ userId, categoryId, month, assigned })
        .onConflictDoUpdate({ target: [budgets.categoryId, budgets.month], set: { assigned } });
    }
  });
}

/**
 * Asigna de golpe a varias categorías:
 *  - copy-previous: lo mismo que se asignó el mes anterior.
 *  - average-3: la media de gasto de los 3 meses anteriores (entre los meses
 *    que tuvieron gasto, para no infravalorar a quien lleva poco tiempo).
 *  - targets: lo que falta para cumplir los objetivos.
 * Las dos primeras solo tocan categorías sin nada asignado este mes.
 */
export async function autoAssign(userId: number, month: string, mode: AutoAssignMode): Promise<AutoAssignResult> {
  let plan: Map<number, number>;
  // Lo que sube la asignación de cada categoría (en "targets" parte de lo ya asignado; en las demás de 0).
  let increase: Map<number, number>;

  if (mode === "targets") {
    const summary = await getBudgetSummary(userId, month);
    const short = summary.groups.flatMap((g) => g.categories).filter((c) => (c.target?.shortfall ?? 0) > 0);
    plan = new Map(short.map((c) => [c.id, roundCents(c.assigned + c.target!.shortfall)] as [number, number]));
    increase = new Map(short.map((c) => [c.id, c.target!.shortfall] as [number, number]));
  } else {
    const currentAssigned = await assignedByCategory(userId, month, month);
    let proposals: Map<number, number>;
    if (mode === "copy-previous") {
      const previous = shiftMonthKey(month, -1);
      proposals = await assignedByCategory(userId, previous, previous);
    } else {
      const start = `${shiftMonthKey(month, -3)}-01`;
      const end = monthEndBoundary(shiftMonthKey(month, -1));
      const [spent, monthsRow] = await Promise.all([
        activityByCategory(userId, end, start),
        db
          .select({ n: sql<number>`count(distinct substr(${transactions.date}, 1, 7))::int` })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              effectiveTransaction(),
              eq(transactions.type, "expense"),
              gte(transactions.date, start),
              lte(transactions.date, end),
            ),
          ),
      ]);
      const months = Math.max(1, monthsRow[0]?.n ?? 0);
      proposals = new Map([...spent].map(([categoryId, total]) => [categoryId, -total / months]));
    }
    plan = planFill(proposals, currentAssigned);
    increase = plan;
  }

  await writeAssignments(userId, month, plan);
  return { categories: plan.size, total: roundCents([...increase.values()].reduce((a, b) => a + b, 0)) };
}

// ─── Mover dinero entre categorías ──────────────────────────────

export type MoveResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Pasa `amount` de lo disponible en una categoría a otra (p. ej. para cubrir un sobregasto). */
export async function moveBetweenCategories(
  userId: number,
  month: string,
  fromCategoryId: number,
  toCategoryId: number,
  amount: number,
): Promise<MoveResult> {
  if (fromCategoryId === toCategoryId) {
    return { ok: false, status: 400, error: "La categoría de origen y la de destino deben ser distintas" };
  }
  const [fromOk, toOk] = await Promise.all([
    categoryBelongsToUser(userId, fromCategoryId),
    categoryBelongsToUser(userId, toCategoryId),
  ]);
  if (!fromOk || !toOk) return { ok: false, status: 404, error: "Categoría no encontrada" };

  const summary = await getBudgetSummary(userId, month);
  const all = summary.groups.flatMap((g) => g.categories);
  const from = all.find((c) => c.id === fromCategoryId);
  const to = all.find((c) => c.id === toCategoryId);
  if (!from || !to) return { ok: false, status: 404, error: "Categoría no encontrada" };
  if (amount > from.available + 0.005) {
    return { ok: false, status: 409, error: "No hay tanto disponible en la categoría de origen" };
  }

  await writeAssignments(
    userId,
    month,
    new Map([
      [fromCategoryId, roundCents(from.assigned - amount)],
      [toCategoryId, roundCents(to.assigned + amount)],
    ]),
  );
  return { ok: true };
}
