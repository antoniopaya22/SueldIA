import { and, eq, gte, ilike, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { categories, transactions } from "../db/schema.js";
import { escapeLike } from "./payee-suggestions.service.js";

// Filtros de movimientos compartidos por el listado (GET /transactions) y la
// exportación: un solo sitio que define qué significa cada filtro, para que
// "exportar con los filtros actuales" exporte exactamente lo que se ve.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const transactionFilterFields = {
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  groupId: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(["expense", "income", "transfer"]).optional(),
  cleared: z.enum(["true", "false"]).optional(),
  payee: z.string().optional(),
  search: z.string().optional(),
  // Movimientos de gasto/ingreso sin categoría (los traspasos nunca tienen).
  uncategorized: z.enum(["true"]).optional(),
  minAmount: z.coerce.number().nonnegative().optional(),
  maxAmount: z.coerce.number().nonnegative().optional(),
};

export const amountRangeValid = (d: { minAmount?: number; maxAmount?: number }) =>
  d.minAmount === undefined || d.maxAmount === undefined || d.minAmount <= d.maxAmount;

export const amountRangeIssue: { message: string; path: string[] } = {
  message: "El importe máximo debe ser mayor o igual que el mínimo",
  path: ["maxAmount"],
};

export type TransactionFilterInput = z.infer<z.ZodObject<typeof transactionFilterFields>>;

/**
 * Todos los filtros salvo el de estado (liquidado/pendiente): sirve para
 * contar los pendientes de una selección aunque se esté filtrando por
 * "liquidadas".
 */
export function buildBaseConditions(userId: number, f: TransactionFilterInput): SQL[] {
  const conditions: SQL[] = [eq(transactions.userId, userId)];
  if (f.accountId) conditions.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId) conditions.push(eq(transactions.categoryId, f.categoryId));
  if (f.uncategorized) conditions.push(isNull(transactions.categoryId), sql`${transactions.type} != 'transfer'`);
  if (f.groupId) {
    conditions.push(
      sql`${transactions.categoryId} IN (
        SELECT ${categories.id} FROM ${categories}
        WHERE ${categories.groupId} = ${f.groupId}
      )`,
    );
  }
  if (f.from) conditions.push(gte(transactions.date, f.from));
  if (f.to) conditions.push(lte(transactions.date, f.to));
  if (f.type) conditions.push(eq(transactions.type, f.type));
  if (f.minAmount !== undefined) conditions.push(gte(transactions.amount, f.minAmount));
  if (f.maxAmount !== undefined) conditions.push(lte(transactions.amount, f.maxAmount));
  if (f.payee) conditions.push(ilike(transactions.payee, `%${escapeLike(f.payee)}%`));
  if (f.search) {
    const pattern = `%${escapeLike(f.search)}%`;
    conditions.push(sql`(${transactions.payee} ILIKE ${pattern} OR ${transactions.memo} ILIKE ${pattern})`);
  }
  return conditions;
}

export function buildConditions(userId: number, f: TransactionFilterInput): SQL[] {
  const conditions = buildBaseConditions(userId, f);
  if (f.cleared === "true") conditions.push(eq(transactions.cleared, true));
  if (f.cleared === "false") conditions.push(eq(transactions.cleared, false));
  return conditions;
}

export const whereAll = (conditions: SQL[]) => and(...conditions);
