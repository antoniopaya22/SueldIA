import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, categoryGroups, categoryRules, transactions } from "../db/schema.js";
import { normalizeText } from "../utils/text.js";

/* ───────── Lógica pura (probada en category-rules.service.test.ts) ───────── */

export interface RuleMatch {
  match: string;
  categoryId: number;
  matchField?: "payee" | "memo" | "any";
  transactionType?: "expense" | "income" | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  accountId?: number | null;
}

export interface RuleTarget {
  payee?: string | null;
  memo?: string | null;
  type?: string;
  /** Importe positivo. */
  amount?: number;
  accountId?: number;
}

/** ¿Cumple el movimiento todas las condiciones de la regla? */
export function ruleMatches(rule: RuleMatch, t: RuleTarget): boolean {
  if (!rule.match) return false;
  const field = rule.matchField ?? "payee";
  const haystacks =
    field === "payee" ? [t.payee] : field === "memo" ? [t.memo] : [t.payee, t.memo];
  if (!haystacks.some((h) => normalizeText(h).includes(rule.match))) return false;
  // Las condiciones que no se pueden comprobar (falta el dato) no se cumplen.
  if (rule.transactionType && t.type !== rule.transactionType) return false;
  if (rule.accountId != null && t.accountId !== rule.accountId) return false;
  if (rule.minAmount != null && (t.amount == null || t.amount < rule.minAmount)) return false;
  if (rule.maxAmount != null && (t.amount == null || t.amount > rule.maxAmount)) return false;
  return true;
}

/** Puntuación de especificidad: más texto y más condiciones = más específica. */
function specificity(rule: RuleMatch): number {
  const conditions = [rule.transactionType, rule.accountId, rule.minAmount, rule.maxAmount].filter((v) => v != null).length;
  return rule.match.length + conditions * 1000;
}

/**
 * Categoría que dicta la regla que encaja con el movimiento. Si encajan
 * varias, gana la más específica: con más condiciones y, a igualdad, con el
 * texto más largo ("amazon prime" antes que "amazon").
 */
export function findRuleFor(t: RuleTarget, rules: RuleMatch[]): number | null {
  let best: RuleMatch | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, t)) continue;
    if (!best || specificity(rule) > specificity(best)) best = rule;
  }
  return best ? best.categoryId : null;
}

/** Atajo cuando solo se conoce el beneficiario (las reglas con más condiciones no aplican). */
export function findRuleCategory(payee: string | null | undefined, rules: RuleMatch[]): number | null {
  return findRuleFor({ payee }, rules);
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
    .select({
      match: categoryRules.match,
      categoryId: categoryRules.categoryId,
      matchField: categoryRules.matchField,
      transactionType: categoryRules.transactionType,
      minAmount: categoryRules.minAmount,
      maxAmount: categoryRules.maxAmount,
      accountId: categoryRules.accountId,
    })
    .from(categoryRules)
    .where(eq(categoryRules.userId, userId));
}

export async function listRules(userId: number) {
  return db
    .select({
      id: categoryRules.id,
      match: categoryRules.match,
      categoryId: categoryRules.categoryId,
      matchField: categoryRules.matchField,
      transactionType: categoryRules.transactionType,
      minAmount: categoryRules.minAmount,
      maxAmount: categoryRules.maxAmount,
      accountId: categoryRules.accountId,
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

export type RuleConditions = Pick<RuleMatch, "matchField" | "transactionType" | "minAmount" | "maxAmount" | "accountId">;

export async function upsertRule(userId: number, match: string, categoryId: number, conditions: RuleConditions = {}) {
  const normalized = normalizeText(match);
  const values = {
    categoryId,
    matchField: conditions.matchField ?? "payee",
    transactionType: conditions.transactionType ?? null,
    minAmount: conditions.minAmount ?? null,
    maxAmount: conditions.maxAmount ?? null,
    accountId: conditions.accountId ?? null,
  };
  const [row] = await db
    .insert(categoryRules)
    .values({ userId, match: normalized, ...values })
    .onConflictDoUpdate({ target: [categoryRules.userId, categoryRules.match], set: values })
    .returning();
  return row;
}

/** Editar una regla existente (texto, categoría o condiciones). */
export async function updateRule(userId: number, id: number, match: string, categoryId: number, conditions: RuleConditions) {
  const [row] = await db
    .update(categoryRules)
    .set({
      match: normalizeText(match),
      categoryId,
      matchField: conditions.matchField ?? "payee",
      transactionType: conditions.transactionType ?? null,
      minAmount: conditions.minAmount ?? null,
      maxAmount: conditions.maxAmount ?? null,
      accountId: conditions.accountId ?? null,
    })
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * A qué movimientos afectaría una regla (antes de guardarla): cuántos encajan,
 * cuántos están sin categoría y una muestra. Sobre los últimos 5.000.
 */
export async function previewRule(userId: number, rule: RuleMatch) {
  const rows = await db
    .select({
      id: transactions.id, date: transactions.date, payee: transactions.payee, memo: transactions.memo,
      type: transactions.type, amount: transactions.amount, accountId: transactions.accountId, categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), sql`${transactions.type} != 'transfer'`))
    .orderBy(sql`${transactions.date} desc`)
    .limit(5000);
  const matched = rows.filter((t) => ruleMatches({ ...rule, match: normalizeText(rule.match) }, t));
  return {
    matched: matched.length,
    uncategorized: matched.filter((t) => t.categoryId == null).length,
    sample: matched.slice(0, 8).map(({ id, date, payee, amount, type }) => ({ id, date, payee, amount, type })),
  };
}

export async function deleteRule(userId: number, id: number): Promise<boolean> {
  const rows = await db
    .delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)))
    .returning({ id: categoryRules.id });
  return rows.length > 0;
}

/** Categoría que dicta alguna regla del usuario para ese beneficiario (se usa al crear movimientos). */
export async function ruleCategoryFor(userId: number, target: RuleTarget | string | null | undefined): Promise<number | null> {
  const t = typeof target === "string" || target == null ? { payee: target } : target;
  if (!t.payee && !t.memo) return null;
  return findRuleFor(t, await loadRules(userId));
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
      .select({ id: transactions.id, type: transactions.type, payee: transactions.payee, memo: transactions.memo, amount: transactions.amount, accountId: transactions.accountId })
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
    const fromRule = findRuleFor(t, rules);
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
