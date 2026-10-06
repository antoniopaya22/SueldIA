import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";
import { categoryBelongsToUser } from "./budgets.service.js";

/* ───────── Dividir un gasto en varias categorías ────────────────
 * Ver el comentario de `splitGroupId` en el esquema: las partes son filas
 * reales enlazadas, no una estructura aparte.
 */

export interface SplitPartInput {
  categoryId: number | null;
  amount: number;
  memo?: string | null;
}

export const MAX_SPLIT_PARTS = 20;

const cents = (n: number) => Math.round(n * 100);

/** Comprueba que las partes forman el total (al céntimo) y son al menos dos (pura, probada). */
export function validateSplit(total: number, parts: Pick<SplitPartInput, "amount">[]): { ok: true } | { ok: false; error: string } {
  if (parts.length < 2) return { ok: false, error: "Divide en al menos dos partes" };
  if (parts.length > MAX_SPLIT_PARTS) return { ok: false, error: `Máximo ${MAX_SPLIT_PARTS} partes` };
  if (parts.some((p) => !(p.amount > 0))) return { ok: false, error: "Cada parte debe ser mayor que cero" };
  const sum = parts.reduce((s, p) => s + cents(p.amount), 0);
  if (sum !== cents(total)) {
    const diff = (sum - cents(total)) / 100;
    return {
      ok: false,
      error: `Las partes deben sumar exactamente ${total.toFixed(2).replace(".", ",")} € (${diff > 0 ? "te pasas" : "te faltan"} ${Math.abs(diff).toFixed(2).replace(".", ",")} €)`,
    };
  }
  return { ok: true };
}

export type SplitResult =
  | { ok: true; groupId: string; ids: number[] }
  | { ok: false; status: number; error: string };

export async function splitTransaction(userId: number, id: number, parts: SplitPartInput[]): Promise<SplitResult> {
  const [tx] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!tx) return { ok: false, status: 404, error: "Transacción no encontrada" };
  if (tx.type === "transfer") return { ok: false, status: 400, error: "Un traspaso no se puede dividir" };
  if (tx.splitGroupId) return { ok: false, status: 409, error: "Ese movimiento ya está dividido: únelo primero para cambiar el reparto" };
  if (tx.recurringTransactionId) return { ok: false, status: 400, error: "Los movimientos recurrentes no se dividen" };
  if (tx.payslipId) return { ok: false, status: 400, error: "Un ingreso enlazado a una nómina no se puede dividir" };

  const valid = validateSplit(tx.amount, parts);
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };

  for (const categoryId of new Set(parts.map((p) => p.categoryId).filter((c): c is number => c !== null))) {
    if (!(await categoryBelongsToUser(userId, categoryId))) return { ok: false, status: 404, error: "Categoría no encontrada" };
  }

  const groupId = randomUUID();
  const ids = await db.transaction(async (trx) => {
    const [first, ...rest] = parts;
    await trx
      .update(transactions)
      .set({ amount: first.amount, categoryId: first.categoryId, memo: first.memo ?? tx.memo, splitGroupId: groupId })
      .where(eq(transactions.id, tx.id));
    const created = rest.length
      ? await trx
          .insert(transactions)
          .values(
            rest.map((p) => ({
              userId,
              accountId: tx.accountId,
              categoryId: p.categoryId,
              type: tx.type,
              amount: p.amount,
              date: tx.date,
              payee: tx.payee,
              memo: p.memo ?? tx.memo,
              cleared: tx.cleared,
              flag: tx.flag,
              importedFrom: tx.importedFrom,
              splitGroupId: groupId,
            })),
          )
          .returning({ id: transactions.id })
      : [];
    return [tx.id, ...created.map((c) => c.id)];
  });
  return { ok: true, groupId, ids };
}

export type UnsplitResult = { ok: true; id: number } | { ok: false; status: number; error: string };

/** Vuelve a dejar un gasto dividido como uno solo (con la categoría de su parte más grande). */
export async function unsplitTransaction(userId: number, id: number): Promise<UnsplitResult> {
  const [tx] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!tx) return { ok: false, status: 404, error: "Transacción no encontrada" };
  if (!tx.splitGroupId) return { ok: false, status: 400, error: "Ese movimiento no está dividido" };

  const parts = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.splitGroupId, tx.splitGroupId)))
    .orderBy(transactions.id);
  const keeper = parts[0];
  const largest = parts.reduce((a, b) => (b.amount > a.amount ? b : a));
  const total = parts.reduce((s, p) => s + cents(p.amount), 0) / 100;

  await db.transaction(async (trx) => {
    await trx
      .update(transactions)
      .set({ amount: total, categoryId: largest.categoryId, splitGroupId: null })
      .where(eq(transactions.id, keeper.id));
    const others = parts.slice(1).map((p) => p.id);
    if (others.length) await trx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, others)));
  });
  return { ok: true, id: keeper.id };
}

/** Ids de todas las partes de los grupos dados (para operaciones que deben tocar el grupo entero). */
export async function splitSiblingIds(userId: number, groupIds: string[]): Promise<number[]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.splitGroupId, groupIds)));
  return rows.map((r) => r.id);
}
