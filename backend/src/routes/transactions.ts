import { Router } from "express";
import { db } from "../db/index.js";
import {
  transactions,
  accounts,
  categories,
  categoryGroups,
  recurringTransactions,
} from "../db/schema.js";
import { eq, and, sql, desc, asc, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { defaultCleared } from "../services/transaction-filters.js";
import { suggestPayees } from "../services/payee-suggestions.service.js";
import { ruleCategoryFor } from "../services/category-rules.service.js";
import { applyBatch, batchSchema } from "../services/transaction-batch.service.js";
import { splitTransaction, unsplitTransaction } from "../services/transaction-split.service.js";
import {
  amountRangeValid, amountRangeIssue, buildBaseConditions, buildConditions, transactionFilterFields,
} from "../services/transaction-query.js";
import { getTodayIsoDate } from "../services/recurring-transactions.service.js";
import { isoDateSchema } from "../utils/dates.js";
import { positiveMoneySchema } from "../utils/validation.js";

export const transactionsRouter = Router();
transactionsRouter.param("id", validateIdParam);

const transactionSchema = z.object({
  accountId: z.number().int().positive("Cuenta requerida"),
  categoryId: z.number().int().positive().nullish(),
  type: z.enum(["expense", "income", "transfer"]),
  amount: positiveMoneySchema("Importe debe ser positivo"),
  date: isoDateSchema,
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
    // El frontend pide 50 por página; cada fila lleva subconsultas.
    limit: z.coerce.number().int().min(1).max(200).default(50),
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
        splitGroupId: transactions.splitGroupId,
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

const splitSchema = z.object({
  parts: z
    .array(
      z.object({
        categoryId: z.number().int().positive().nullable(),
        amount: positiveMoneySchema("Cada parte debe ser mayor que cero"),
        memo: z.string().max(500).nullish(),
      }),
    )
    .min(2, "Divide en al menos dos partes")
    .max(20),
});

// Dividir un gasto en varias categorías (las partes deben sumar el total).
transactionsRouter.post("/:id/split", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = splitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const result = await splitTransaction(userId, Number(req.params.id), parsed.data.parts);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ groupId: result.groupId, ids: result.ids });
  } catch (err) {
    next(err);
  }
});

// Volver a dejar un gasto dividido como uno solo.
transactionsRouter.post("/:id/unsplit", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const result = await unsplitTransaction(userId, Number(req.params.id));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ id: result.id });
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
// Beneficiarios del usuario con cuántos movimientos y cuánto suman (para
// renombrar o fusionar variantes: "MERCADONA 1234" y "Mercadona").
transactionsRouter.get("/payees/summary", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const rows = await db
      .select({
        payee: transactions.payee,
        count: sql<number>`count(*)::int`,
        expense: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)`,
        income: sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
        lastDate: sql<string>`max(${transactions.date})`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.type} != 'transfer'`, sql`${transactions.payee} is not null and ${transactions.payee} <> ''`))
      .groupBy(transactions.payee)
      .orderBy(sql`count(*) desc`)
      .limit(1000);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

const renamePayeesSchema = z.object({
  from: z.array(z.string().min(1).max(200)).min(1).max(100),
  to: z.string().trim().min(1, "Escribe el nombre").max(200),
});

// Renombrar uno o varios beneficiarios a uno solo (fusionar variantes), en
// movimientos y en programaciones recurrentes.
transactionsRouter.post("/payees/rename", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = renamePayeesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const { from, to } = parsed.data;
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(transactions)
        .set({ payee: to })
        .where(and(eq(transactions.userId, userId), inArray(transactions.payee, from)))
        .returning({ id: transactions.id });
      await tx
        .update(recurringTransactions)
        .set({ payee: to })
        .where(and(eq(recurringTransactions.userId, userId), inArray(recurringTransactions.payee, from)));
      return rows.length;
    });
    res.json({ ok: true, updated });
  } catch (err) {
    next(err);
  }
});

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
      const ruleCategoryId = await ruleCategoryFor(userId, { payee: txData.payee, memo: txData.memo, type: txData.type, amount: txData.amount, accountId: txData.accountId });
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

    if (existing.splitGroupId && nextType !== existing.type) {
      return res.status(400).json({ error: "Une las partes del gasto dividido antes de cambiar su tipo" });
    }

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

      // Fecha, cuenta, beneficiario, etiqueta y estado son del gasto, no de una parte: se igualan en todas.
      if (existing.splitGroupId) {
        await tx
          .update(transactions)
          .set({
            accountId: updated.accountId,
            date: updated.date,
            payee: updated.payee,
            flag: updated.flag,
            cleared: updated.cleared,
          })
          .where(and(eq(transactions.userId, userId), eq(transactions.splitGroupId, existing.splitGroupId)));
      }

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

      // Un gasto dividido es un solo gasto: se borra entero, no una parte suelta.
      if (existing.splitGroupId) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.userId, userId), eq(transactions.splitGroupId, existing.splitGroupId)));
        return;
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

    // `{ cleared }` explícito hace la petición idempotente (un reintento de
    // red no deshace el cambio); sin cuerpo, se alterna como antes.
    const body = z.object({ cleared: z.boolean().optional() }).safeParse(req.body ?? {});
    const cleared = body.success && body.data.cleared !== undefined ? body.data.cleared : !existing.cleared;

    // Misma lógica que la acción en lote: arrastra la otra pata de un traspaso
    // y todas las partes de un gasto dividido. Antes solo cambiaba la fila
    // pedida y un traspaso quedaba liquidado en una cuenta y pendiente en la
    // otra — el dinero salía de una sin entrar en la otra.
    await applyBatch(userId, { action: "set-cleared", ids: [id], cleared });
    const [updated] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
