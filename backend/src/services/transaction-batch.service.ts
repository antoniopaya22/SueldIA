import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { transactions } from "../db/schema.js";
import { categoryBelongsToUser } from "./budgets.service.js";

const ids = z.array(z.number().int().positive()).min(1, "Selecciona al menos un movimiento").max(500, "Máximo 500 movimientos por operación");

export const batchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-category"), ids, categoryId: z.number().int().positive().nullable() }),
  z.object({ action: z.literal("set-cleared"), ids, cleared: z.boolean() }),
  z.object({ action: z.literal("delete"), ids }),
]);

export type BatchInput = z.infer<typeof batchSchema>;

export type BatchResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; status: number; error: string };

/**
 * Operación sobre varios movimientos a la vez (categorizar, liquidar, borrar).
 * Solo toca los del usuario; lo que no se puede tocar se cuenta en `skipped`:
 * - categorizar ignora traspasos (no tienen categoría);
 * - borrar ignora los de una recurrente (se gestionan desde su programación);
 * - liquidar y borrar arrastran la otra pata de un traspaso, para que el par
 *   nunca quede a medias.
 */
export async function applyBatch(userId: number, input: BatchInput): Promise<BatchResult> {
  const requested = [...new Set(input.ids)];
  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      transferId: transactions.transferId,
      recurringTransactionId: transactions.recurringTransactionId,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, requested)));

  const withPairs = (selected: typeof rows) =>
    [...new Set(selected.flatMap((r) => (r.transferId ? [r.id, r.transferId] : [r.id])))];

  switch (input.action) {
    case "set-category": {
      if (input.categoryId !== null && !(await categoryBelongsToUser(userId, input.categoryId))) {
        return { ok: false, status: 404, error: "Categoría no encontrada" };
      }
      const targets = rows.filter((r) => r.type !== "transfer").map((r) => r.id);
      if (targets.length > 0) {
        await db
          .update(transactions)
          .set({ categoryId: input.categoryId })
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, targets)));
      }
      return { ok: true, updated: targets.length, skipped: requested.length - targets.length };
    }

    case "set-cleared": {
      if (rows.length > 0) {
        await db
          .update(transactions)
          .set({ cleared: input.cleared })
          .where(and(eq(transactions.userId, userId), inArray(transactions.id, withPairs(rows))));
      }
      return { ok: true, updated: rows.length, skipped: requested.length - rows.length };
    }

    case "delete": {
      const deletable = rows.filter((r) => !r.recurringTransactionId);
      if (deletable.length > 0) {
        const toDelete = withPairs(deletable);
        await db.transaction(async (tx) => {
          await tx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, toDelete)));
        });
      }
      return { ok: true, updated: deletable.length, skipped: requested.length - deletable.length };
    }
  }
}
