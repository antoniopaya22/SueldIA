import { Router } from "express";
import { db } from "../db/index.js";
import {
  transactions,
  accounts,
  categories,
  categoryGroups,
} from "../db/schema.js";
import { eq, and, sql, desc, asc, gte, lte, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { defaultCleared } from "../services/transaction-filters.js";
import { suggestPayees } from "../services/payee-suggestions.service.js";
import { ruleCategoryFor } from "../services/category-rules.service.js";
import { applyBatch, batchSchema } from "../services/transaction-batch.service.js";
import {
  amountRangeValid, amountRangeIssue, buildBaseConditions, buildConditions, transactionFilterFields,
} from "../services/transaction-query.js";
import { getTodayIsoDate } from "../services/recurring-transactions.service.js";

export const transactionsRouter = Router();
transactionsRouter.param("id", validateIdParam);

const transactionSchema = z.object({
  accountId: z.number().int().positive("Cuenta requerida"),
  categoryId: z.number().int().positive().nullish(),
  type: z.enum(["expense", "income", "transfer"]),
  amount: z.number().positive("Importe debe ser positivo"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  payee: z.string().max(200).nullish(),
  memo: z.string().max(500).nullish(),
  cleared: z.boolean().optional(),
  flag: z.string().max(100).nullish(),
  // For transfers: destination account
  targetAccountId: z.number().int().positive().optional(),
});

const filtersSchema = z
  .object({
    ...transactionFilterFields,
    sortBy: z.enum(["date", "payee", "category", "amount", "type"]).default("date"),
    sortDir: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(10000).default(50),
  })
  .refine(amountRangeValid, amountRangeIssue);

const updateTransactionSchema = transactionSchema.partial();

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getTransferDirection(
  id: number,
  transferId: number | null,
): "outflow" | "inflow" | null {
  if (transferId == null) {
    return null;
  }

  return transferId < id ? "inflow" : "outflow";
}

async function getOwnedAccount(accountId: number, userId: number) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

  return account ?? null;
}

async function getOwnedCategory(categoryId: number, userId: number) {
  const [category] = await db
    .select({ id: categories.id, groupId: categories.groupId })
    .from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(categories.id, categoryId), eq(categoryGroups.userId, userId)));

  return category ?? null;
}

// List transactions with filters
transactionsRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    // Igual que en GET /recurring-transactions: la generación de ocurrencias
    // ya no vive en un GET — cron diario + tras crear/editar/activar la regla.
    const parsed = filtersSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { sortBy, sortDir, page, limit, ...filters } = parsed.data;
    const offset = (page - 1) * limit;

    // `base` = todos los filtros salvo el de estado: sirve para contar los
    // pendientes de la selección aunque se esté filtrando por "liquidadas".
    const base = buildBaseConditions(userId, filters);
    const conditions = buildConditions(userId, filters);

    const whereClause = and(...conditions);

    // Totales con exactamente los mismos filtros que la lista (los traspasos no son ingreso ni gasto),
    // más los pendientes de esa selección y cuántos GASTOS tiene el usuario sin categoría en total
    // (un ingreso sin categoría es lo normal: el presupuesto lo cuenta entero, no necesita una).
    const [[{ count }], [totals], [{ pending }], [{ uncategorizedExpenses }]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(transactions).where(whereClause),
      db
        .select({
          income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end), 0)`,
          expense: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        })
        .from(transactions)
        .where(whereClause),
      db
        .select({ pending: sql<number>`count(*)::int` })
        .from(transactions)
        .where(and(...base, eq(transactions.cleared, false))),
      db
        .select({ uncategorizedExpenses: sql<number>`count(*)::int` })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), isNull(transactions.categoryId), eq(transactions.type, "expense"))),
    ]);
    const income = Math.round(Number(totals.income) * 100) / 100;
    const expense = Math.round(Number(totals.expense) * 100) / 100;

    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        categoryId: transactions.categoryId,
        categoryName: sql<string>`coalesce(${categories.name}, '')`,
        groupName: sql<string>`coalesce(${categoryGroups.name}, '')`,
        type: transactions.type,
        amount: transactions.amount,
        date: transactions.date,
        recurringTransactionId: transactions.recurringTransactionId,
        scheduledFor: transactions.scheduledFor,
        payee: transactions.payee,
        memo: transactions.memo,
        cleared: transactions.cleared,
        transferId: transactions.transferId,
        targetAccountId: sql<number | null>`case
          when ${transactions.type} = 'transfer' and ${transactions.transferId} is not null
            then (select account_id from transactions paired_transactions where paired_transactions.id = ${transactions.transferId})
          else null
        end`,
        targetAccountName: sql<string>`coalesce(case
          when ${transactions.type} = 'transfer' and ${transactions.transferId} is not null
            then (
              select name from accounts paired_accounts
              where paired_accounts.id = (
                select account_id from transactions paired_transactions where paired_transactions.id = ${transactions.transferId}
              )
            )
          else null
        end, '')`,
        transferDirection: sql<"outflow" | "inflow" | null>`case
          when ${transactions.type} != 'transfer' or ${transactions.transferId} is null then null
          when ${transactions.transferId} < ${transactions.id} then 'inflow'
          else 'outflow'
        end`,
        flag: transactions.flag,
        importedFrom: transactions.importedFrom,
        payslipId: transactions.payslipId,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(whereClause)
      .orderBy(
        (() => {
          const dir = sortDir === "asc" ? asc : desc;
          switch (sortBy) {
            case "payee": return dir(transactions.payee);
            case "amount": return dir(transactions.amount);
            case "type": return dir(transactions.type);
            case "category": return dir(categories.name);
            default: return dir(transactions.date);
          }
        })(),
        desc(transactions.id),
      )
      .limit(limit)
      .offset(offset);

    res.json({
      data: rows,
      total: count,
      page,
      limit,
      summary: { income, expense, net: Math.round((income - expense) * 100) / 100, pending, uncategorizedExpenses },
    });
  } catch (err) {
    next(err);
  }
});

// Categorizar, liquidar o borrar varios movimientos a la vez.
transactionsRouter.post("/batch", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Operación inválida",
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await applyBatch(userId, parsed.data);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ updated: result.updated, skipped: result.skipped });
  } catch (err) {
    next(err);
  }
});

const payeeSuggestionsSchema = z.object({
  q: z.string().max(100).optional(),
  type: z.enum(["expense", "income"]).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// Beneficiarios ya usados, con categoría/cuenta/importe de su último movimiento
// (autocompletado del formulario). Antes de /:id: si no, "payees" se leería como id.
transactionsRouter.get("/payees", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = payeeSuggestionsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const data = await suggestPayees(userId, parsed.data);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// Get single transaction
transactionsRouter.get("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!row) return res.status(404).json({ error: "Transacción no encontrada" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// Create transaction
transactionsRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = transactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de transacción inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const account = await getOwnedAccount(parsed.data.accountId, userId);
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });

    const { targetAccountId, ...txData } = parsed.data;
    const cleared = txData.cleared ?? defaultCleared(txData.date, getTodayIsoDate());

    // Sin categoría, una regla automática del usuario puede ponerla según el beneficiario.
    if (txData.type !== "transfer" && txData.categoryId == null) {
      const ruleCategoryId = await ruleCategoryFor(userId, txData.payee);
      if (ruleCategoryId !== null) txData.categoryId = ruleCategoryId;
    }

    if (txData.type !== "transfer" && txData.categoryId != null) {
      const category = await getOwnedCategory(txData.categoryId, userId);
      if (!category) {
        return res.status(404).json({ error: "Categoría no encontrada" });
      }
    }

    if (txData.type === "transfer") {
      if (!targetAccountId) {
        return res.status(400).json({ error: "Cuenta destino requerida para transferencias" });
      }

      if (targetAccountId === txData.accountId) {
        return res.status(400).json({ error: "La cuenta destino debe ser distinta de la cuenta origen" });
      }

      const target = await getOwnedAccount(targetAccountId, userId);
      if (!target) return res.status(404).json({ error: "Cuenta destino no encontrada" });

      // Las dos patas de la transferencia + el enlace entre ellas se crean
      // como una sola unidad: sin la transacción, un fallo a mitad dejaba un
      // outflow huérfano sin transferId, o un inflow apuntando a un outflow
      // que nunca llegó a enlazarse de vuelta.
      const { outflow, inflow } = await db.transaction(async (tx) => {
        const [outflow] = await tx
          .insert(transactions)
          .values({
            ...txData,
            userId,
            categoryId: null,
            payee: normalizeOptionalText(txData.payee),
            memo: normalizeOptionalText(txData.memo),
            flag: normalizeOptionalText(txData.flag),
            cleared,
          })
          .returning();

        const [inflow] = await tx
          .insert(transactions)
          .values({
            accountId: targetAccountId,
            categoryId: null,
            type: "transfer",
            amount: txData.amount,
            date: txData.date,
            payee: `Transfer : ${account.name}`,
            memo: normalizeOptionalText(txData.memo),
            cleared,
            flag: normalizeOptionalText(txData.flag),
            userId,
            transferId: outflow.id,
          })
          .returning();

        await tx
          .update(transactions)
          .set({ transferId: inflow.id })
          .where(eq(transactions.id, outflow.id));

        return { outflow, inflow };
      });

      res.status(201).json({
        ...outflow,
        categoryId: null,
        payee: normalizeOptionalText(txData.payee),
        memo: normalizeOptionalText(txData.memo),
        flag: normalizeOptionalText(txData.flag),
        transferId: inflow.id,
        targetAccountId,
        targetAccountName: target.name,
        transferDirection: "outflow",
      });
    } else {
      const [tx] = await db
        .insert(transactions)
        .values({
          ...txData,
          userId,
          categoryId: txData.categoryId ?? null,
          payee: normalizeOptionalText(txData.payee),
          memo: normalizeOptionalText(txData.memo),
          flag: normalizeOptionalText(txData.flag),
          cleared,
        })
        .returning();
      res.status(201).json(tx);
    }
  } catch (err) {
    next(err);
  }
});

// Update transaction
transactionsRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const parsed = updateTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de transacción inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: "No hay cambios para guardar" });
    }

    const [existing] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Transacción no encontrada" });

    const isExistingTransfer = existing.type === "transfer" && existing.transferId != null;
    const transferDirection = getTransferDirection(existing.id, existing.transferId ?? null);
    const paired = isExistingTransfer
      ? (await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, existing.transferId!), eq(transactions.userId, userId))))[0] ?? null
      : null;

    if (isExistingTransfer && !paired) {
      return res.status(404).json({ error: "No se ha encontrado la cuenta vinculada de la transferencia" });
    }

    const sourceTx = transferDirection === "inflow" && paired ? paired : existing;
    const targetTx = transferDirection === "inflow" ? existing : paired;
    const nextType = parsed.data.type ?? existing.type;

    if (nextType === "transfer") {
      const sourceAccountId = parsed.data.accountId ?? sourceTx.accountId;
      const destinationAccountId = parsed.data.targetAccountId ?? targetTx?.accountId;

      if (!destinationAccountId) {
        return res.status(400).json({ error: "Cuenta destino requerida para transferencias" });
      }

      if (sourceAccountId === destinationAccountId) {
        return res.status(400).json({ error: "La cuenta destino debe ser distinta de la cuenta origen" });
      }

      const [sourceAccount, destinationAccount] = await Promise.all([
        getOwnedAccount(sourceAccountId, userId),
        getOwnedAccount(destinationAccountId, userId),
      ]);

      if (!sourceAccount) return res.status(404).json({ error: "Cuenta origen no encontrada" });
      if (!destinationAccount) return res.status(404).json({ error: "Cuenta destino no encontrada" });

      const sourcePayload = {
        accountId: sourceAccountId,
        categoryId: null,
        type: "transfer" as const,
        amount: parsed.data.amount ?? sourceTx.amount,
        date: parsed.data.date ?? sourceTx.date,
        payee: Object.prototype.hasOwnProperty.call(parsed.data, "payee")
          ? normalizeOptionalText(parsed.data.payee)
          : sourceTx.payee,
        memo: Object.prototype.hasOwnProperty.call(parsed.data, "memo")
          ? normalizeOptionalText(parsed.data.memo)
          : sourceTx.memo,
        cleared: parsed.data.cleared ?? sourceTx.cleared,
        flag: Object.prototype.hasOwnProperty.call(parsed.data, "flag")
          ? normalizeOptionalText(parsed.data.flag)
          : sourceTx.flag,
      };

      if (targetTx) {
        // Actualizar las dos patas es una sola unidad: a medias, una se
        // queda con datos nuevos y la otra con los viejos.
        const updated = await db.transaction(async (tx) => {
          await tx
            .update(transactions)
            .set({
              accountId: destinationAccountId,
              categoryId: null,
              type: "transfer",
              amount: sourcePayload.amount,
              date: sourcePayload.date,
              payee: `Transfer : ${sourceAccount.name}`,
              memo: sourcePayload.memo,
              cleared: sourcePayload.cleared,
              flag: sourcePayload.flag,
              transferId: sourceTx.id,
            })
            .where(eq(transactions.id, targetTx.id));

          const [updated] = await tx
            .update(transactions)
            .set({ ...sourcePayload, transferId: targetTx.id })
            .where(eq(transactions.id, sourceTx.id))
            .returning();

          return updated;
        });

        return res.json({
          ...updated,
          targetAccountId: destinationAccountId,
          targetAccountName: destinationAccount.name,
          transferDirection: "outflow",
        });
      }

      // Igual aquí: crear la pata destino + enlazar ambas patas entre sí.
      const updated = await db.transaction(async (tx) => {
        const [createdTarget] = await tx
          .insert(transactions)
          .values({
            accountId: destinationAccountId,
            categoryId: null,
            type: "transfer",
            amount: sourcePayload.amount,
            date: sourcePayload.date,
            payee: `Transfer : ${sourceAccount.name}`,
            memo: sourcePayload.memo,
            cleared: sourcePayload.cleared,
            flag: sourcePayload.flag,
            userId,
            recurringTransactionId: null,
            scheduledFor: null,
          })
          .returning();

        const [updated] = await tx
          .update(transactions)
          .set({ ...sourcePayload, transferId: createdTarget.id })
          .where(eq(transactions.id, existing.id))
          .returning();

        await tx
          .update(transactions)
          .set({ transferId: updated.id })
          .where(eq(transactions.id, createdTarget.id));

        return updated;
      });

      return res.json({
        ...updated,
        targetAccountId: destinationAccountId,
        targetAccountName: destinationAccount.name,
        transferDirection: "outflow",
      });
    }

    const nextAccountId = parsed.data.accountId ?? existing.accountId;
    const account = await getOwnedAccount(nextAccountId, userId);
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });

    const nextCategoryId = Object.prototype.hasOwnProperty.call(parsed.data, "categoryId")
      ? parsed.data.categoryId ?? null
      : isExistingTransfer
        ? null
        : existing.categoryId;

    if (nextCategoryId != null) {
      const category = await getOwnedCategory(nextCategoryId, userId);
      if (!category) {
        return res.status(404).json({ error: "Categoría no encontrada" });
      }
    }

    // Si esto convierte una transferencia en un movimiento normal, la
    // actualización y el borrado de la pata pareja van juntos: si no,
    // podría sobrevivir una pata "transfer" sin la otra al otro lado.
    const updated = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(transactions)
        .set({
          accountId: nextAccountId,
          categoryId: nextCategoryId,
          type: nextType,
          amount: parsed.data.amount ?? existing.amount,
          date: parsed.data.date ?? existing.date,
          payee: Object.prototype.hasOwnProperty.call(parsed.data, "payee")
            ? normalizeOptionalText(parsed.data.payee)
            : existing.payee,
          memo: Object.prototype.hasOwnProperty.call(parsed.data, "memo")
            ? normalizeOptionalText(parsed.data.memo)
            : existing.memo,
          cleared: parsed.data.cleared ?? existing.cleared,
          flag: Object.prototype.hasOwnProperty.call(parsed.data, "flag")
            ? normalizeOptionalText(parsed.data.flag)
            : existing.flag,
          transferId: null,
        })
        .where(and(eq(transactions.id, existing.id), eq(transactions.userId, userId)))
        .returning();

      if (!updated) return null;

      if (paired) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.id, paired.id), eq(transactions.userId, userId)));
      }

      return updated;
    });

    if (!updated) return res.status(404).json({ error: "Transacción no encontrada" });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete transaction (and paired transfer if exists)
transactionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Transacción no encontrada" });

    if (existing.recurringTransactionId) {
      return res.status(400).json({
        error: "Las transacciones recurrentes se gestionan desde su programación",
      });
    }

    // Ambos borrados van juntos: si no, un fallo a mitad podía dejar viva
    // la pata pareja de una transferencia ya borrada, con un transferId que
    // apunta a nada.
    await db.transaction(async (tx) => {
      if (existing.transferId) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.id, existing.transferId), eq(transactions.userId, userId)));
      }

      await tx.delete(transactions).where(eq(transactions.id, id));
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Toggle cleared
transactionsRouter.patch("/:id/clear", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Transacción no encontrada" });

    const [updated] = await db
      .update(transactions)
      .set({ cleared: !existing.cleared })
      .where(eq(transactions.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Bulk create (for import)
transactionsRouter.post("/bulk", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const bulkSchema = z.array(
      z.object({
        accountId: z.number().int().positive(),
        categoryId: z.number().int().positive().nullish(),
        type: z.enum(["expense", "income", "transfer"]),
        amount: z.number().nonnegative(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        payee: z.string().max(200).nullish(),
        memo: z.string().max(500).nullish(),
        cleared: z.boolean().optional(),
        flag: z.string().max(100).nullish(),
        transferId: z.number().int().nullish(),
        importedFrom: z.string().max(50).nullish(),
      }),
    );

    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de importación inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // Pre-load valid account and category IDs for ownership validation
    const userAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    const validAccountIds = new Set(userAccounts.map((a) => a.id));

    const userCategories = await db
      .select({ id: categories.id })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(eq(categoryGroups.userId, userId));
    const validCategoryIds = new Set(userCategories.map((c) => c.id));

    const referencedTransferIds = [...new Set(parsed.data.map((tx) => tx.transferId).filter((id): id is number => id != null))];
    const validTransferIds =
      referencedTransferIds.length === 0
        ? new Set<number>()
        : new Set(
            (
              await db
                .select({ id: transactions.id })
                .from(transactions)
                .where(and(eq(transactions.userId, userId), inArray(transactions.id, referencedTransferIds)))
            ).map((t) => t.id),
          );

    for (const tx of parsed.data) {
      if (!validAccountIds.has(tx.accountId)) {
        return res.status(400).json({ error: `Cuenta ${tx.accountId} no pertenece al usuario` });
      }
      if (tx.categoryId && !validCategoryIds.has(tx.categoryId)) {
        return res.status(400).json({ error: `Categoría ${tx.categoryId} no pertenece al usuario` });
      }
      if (tx.transferId != null && !validTransferIds.has(tx.transferId)) {
        return res.status(400).json({ error: `Transacción de transferencia ${tx.transferId} no pertenece al usuario` });
      }
    }

    const rows = parsed.data.map((tx) => ({
      ...tx,
      userId,
      categoryId: tx.categoryId ?? null,
      payee: tx.payee ?? null,
      memo: tx.memo ?? null,
      flag: tx.flag ?? null,
      transferId: tx.transferId ?? null,
      importedFrom: tx.importedFrom ?? null,
      cleared: tx.cleared ?? false,
    }));

    let inserted = 0;
    // Insert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await db.insert(transactions).values(batch);
      inserted += batch.length;
    }

    res.status(201).json({ ok: true, inserted });
  } catch (err) {
    next(err);
  }
});
