import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, categoryGroups, categoryRules, transactions } from "../db/schema.js";
import { normalizeText } from "../utils/text.js";

/* ───────── Lógica pura (probada en category-rules.service.test.ts) ───────── */

export interface RuleMatch {
  match: string;
  categoryId: number;
}

/**
 * Categoría que dicta la regla que encaja con el beneficiario. Si encajan
 * varias, gana la más específica (el texto más largo): "amazon prime" antes
 * que "amazon".
 */
export function findRuleCategory(payee: string | null | undefined, rules: RuleMatch[]): number | null {
  const p = normalizeText(payee);
  if (!p) return null;
  let best: RuleMatch | null = null;
  for (const rule of rules) {
    if (!rule.match || !p.includes(rule.match)) continue;
    if (!best || rule.match.length > best.match.length) best = rule;
  }
  return best ? best.categoryId : null;
}

/** payee normalizado → categoría → veces que se ha usado (con el tipo delante: "expense:mercadona"). */
export type PayeeHistory = Map<string, Map<number, number>>;

export function buildPayeeHistory(rows: { type: string; payee: string; categoryId: number; n: number }[]): PayeeHistory {
  const history: PayeeHistory = new Map();
  for (const row of rows) {
    const key = `${row.type}:${normalizeText(row.payee)}`;
    const byCategory = history.get(key) ?? new Map<number, number>();
    byCategory.set(row.categoryId, (byCategory.get(row.categoryId) ?? 0) + row.n);
    history.set(key, byCategory);
  }
  return history;
}

/** La categoría que más se ha usado con ese beneficiario (y tipo), o null si nunca se categorizó. */
export function pickHistoryCategory(type: string, payee: string | null | undefined, history: PayeeHistory): number | null {
  const p = normalizeText(payee);
  if (!p) return null;
  const byCategory = history.get(`${type}:${p}`);
  if (!byCategory) return null;
  let best: number | null = null;
  let bestCount = 0;
  for (const [categoryId, n] of byCategory) {
    if (n > bestCount) {
      best = categoryId;
      bestCount = n;
    }
  }
  return best;
}

/* ───────── Con base de datos ───────── */

export async function loadRules(userId: number): Promise<RuleMatch[]> {
  return db
    .select({ match: categoryRules.match, categoryId: categoryRules.categoryId })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId));
}

export async function listRules(userId: number) {
  return db
    .select({
      id: categoryRules.id,
      match: categoryRules.match,
      categoryId: categoryRules.categoryId,
      categoryName: categories.name,
      groupName: categoryGroups.name,
      createdAt: categoryRules.createdAt,
    })
    .from(categoryRules)
    .innerJoin(categories, eq(categoryRules.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(eq(categoryRules.userId, userId))
    .orderBy(categoryRules.match);
}

export async function upsertRule(userId: number, match: string, categoryId: number) {
  const normalized = normalizeText(match);
  const [row] = await db
    .insert(categoryRules)
    .values({ userId, match: normalized, categoryId })
    .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.match], set: { categoryId } })
    .returning();
  return row;
}

export async function deleteRule(userId: number, id: number): Promise<boolean> {
  const rows = await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning({ id: categoryRules.id });
  return rows.length > 0;
}

/** Categoría que dicta alguna regla del usuario para ese beneficiario (se usa al crear movimientos). */
export async function ruleCategoryFor(userId: number, payee: string | null | undefined): Promise<number | null> {
  if (!payee) return null;
  return findRuleCategory(payee, await loadRules(userId));
}

export interface ApplyResult {
  updated: number;
  /** Sin sugerencia: ninguna regla encaja y ese beneficiario nunca se ha categorizado. */
  skipped: number;
  byRule: number;
  byHistory: number;
}

/**
 * Categoriza movimientos sin categoría (gastos e ingresos; los traspasos no
 * tienen) con las reglas del usuario y, si no hay regla, con la categoría que
 * más ha usado con ese beneficiario. Si se pasan `ids`, solo esos.
 */
export async function applySuggestions(userId: number, ids?: number[]): Promise<ApplyResult> {
  const conditions = [
    eq(transactions.userId, userId),
    isNull(transactions.categoryId),
    sql`${transactions.type} != 'transfer'`,
    sql`${transactions.payee} is not null and ${transactions.payee} <> ''`,
  ];
  if (ids) conditions.push(inArray(transactions.id, ids));
  // Sin `ids` (categorizar "todo") solo se consideran gastos: un ingreso sin categoría es lo normal
  // (p. ej. la nómina) y no debe contar como "sin sugerencia".
  else conditions.push(eq(transactions.type, "expense"));

  const [targets, rules, historyRows] = await Promise.all([
    db
      .select({ id: transactions.id, type: transactions.type, payee: transactions.payee })
      .from(transactions)
      .where(and(...conditions)),
    loadRules(userId),
    db
      .select({
        type: transactions.type,
        payee: sql<string>`lower(${transactions.payee})`,
        categoryId: transactions.categoryId,
        n: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`${transactions.categoryId} is not null`,
          sql`${transactions.type} != 'transfer'`,
          sql`${transactions.payee} is not null and ${transactions.payee} <> ''`,
        ),
      )
      .groupBy(transactions.type, sql`lower(${transactions.payee})`, transactions.categoryId),
  ]);

  const history = buildPayeeHistory(
    historyRows.map((r) => ({ type: r.type, payee: r.payee, categoryId: r.categoryId as number, n: r.n })),
  );

  const byCategory = new Map<number, number[]>();
  let byRule = 0;
  let byHistory = 0;
  for (const t of targets) {
    const fromRule = findRuleCategory(t.payee, rules);
    const categoryId = fromRule ?? pickHistoryCategory(t.type, t.payee, history);
    if (categoryId === null) continue;
    if (fromRule !== null) byRule++;
    else byHistory++;
    byCategory.set(categoryId, [...(byCategory.get(categoryId) ?? []), t.id]);
  }

  if (byCategory.size > 0) {
    await db.transaction(async (tx) => {
      for (const [categoryId, txIds] of byCategory) {
        await tx
          .update(transactions)
          .set({ categoryId })
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, txIds)));
      }
    });
  }

  const updated = byRule + byHistory;
  // Sin `ids`, "omitidos" = los que no tienen sugerencia; con `ids`, también los que ya tenían categoría o no existen.
  const considered = ids ? new Set(ids).size : targets.length;
  return { updated, skipped: considered - updated, byRule, byHistory };
}
