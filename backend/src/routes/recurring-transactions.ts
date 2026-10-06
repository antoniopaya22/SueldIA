import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getSubscriptionSuggestions } from "../services/subscriptions.service.js";
import { validateIdParam } from "../middleware/params.js";
import { db } from "../db/index.js";
import {
  accounts,
  categories,
  categoryGroups,
  recurringTransactions,
} from "../db/schema.js";
import {
  countPendingOccurrencesByRule,
  deletePendingRecurringOccurrences,
  getNextOccurrenceDate,
  getRecurringSyncThroughDate,
  getTodayIsoDate,
  syncRecurringTransactions,
} from "../services/recurring-transactions.service.js";

export const recurringTransactionsRouter = Router();
recurringTransactionsRouter.param("id", validateIdParam);

const recurringTransactionSchema = z
  .object({
    accountId: z.number().int().positive("Cuenta requerida"),
    categoryId: z.number().int().positive().nullish(),
    type: z.enum(["expense", "income"]),
    amount: z.number().positive("Importe debe ser positivo"),
    cadence: z.enum(["weekly", "monthly", "yearly"]),
    intervalCount: z.number().int().min(1).max(12).default(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD").nullish(),
    payee: z.string().max(200).nullish(),
    memo: z.string().max(500).nullish(),
    flag: z.string().max(100).nullish(),
    autoSettle: z.boolean().default(false),
  })
  .refine(
    (value) => !value.endDate || value.endDate >= value.startDate,
    {
      message: "La fecha de fin no puede ser anterior al inicio",
      path: ["endDate"],
    },
  );

const recurringTransactionActiveSchema = z.object({
  active: z.boolean(),
});

async function categoryBelongsToUser(userId: number, categoryId: number): Promise<boolean> {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(categories.id, categoryId), eq(categoryGroups.userId, userId)));

  return !!category;
}

recurringTransactionsRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    // La generación de ocurrencias ya no pasa por aquí (un GET no debería
    // escribir) — corre en el cron diario y justo tras crear/editar/activar
    // una regla, que es cuando de verdad puede haber cambiado algo.

    const rules = await db
      .select({
        id: recurringTransactions.id,
        accountId: recurringTransactions.accountId,
        accountName: accounts.name,
        categoryId: recurringTransactions.categoryId,
        categoryName: sql<string>`coalesce(${categories.name}, '')`,
        groupName: sql<string>`coalesce(${categoryGroups.name}, '')`,
        type: recurringTransactions.type,
        amount: recurringTransactions.amount,
        cadence: recurringTransactions.cadence,
        intervalCount: recurringTransactions.intervalCount,
        startDate: recurringTransactions.startDate,
        endDate: recurringTransactions.endDate,
        payee: recurringTransactions.payee,
        memo: recurringTransactions.memo,
        flag: recurringTransactions.flag,
        active: recurringTransactions.active,
        autoSettle: recurringTransactions.autoSettle,
        createdAt: recurringTransactions.createdAt,
      })
      .from(recurringTransactions)
      .innerJoin(accounts, eq(recurringTransactions.accountId, accounts.id))
      .leftJoin(categories, eq(recurringTransactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(eq(recurringTransactions.userId, userId))
      .orderBy(desc(recurringTransactions.active), recurringTransactions.payee, recurringTransactions.startDate);

    const today = getTodayIsoDate();
    const pendingCounts = await countPendingOccurrencesByRule(userId);

    res.json({
      data: rules.map((rule) => ({
        ...rule,
        nextOccurrence: getNextOccurrenceDate(
          {
            startDate: rule.startDate,
            endDate: rule.endDate,
            cadence: rule.cadence,
            intervalCount: rule.intervalCount,
          },
          today,
        ),
        pendingCount: pendingCounts.get(rule.id)?.pending ?? 0,
        // Las ya vencidas (fecha de hoy o anterior): lo que de verdad hay que revisar.
        overdueCount: pendingCounts.get(rule.id)?.overdue ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Gastos que se repiten cada mes y aún no están programados (para proponer crear la regla).
recurringTransactionsRouter.get("/suggestions", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    res.json({ data: await getSubscriptionSuggestions(userId) });
  } catch (err) {
    next(err);
  }
});

recurringTransactionsRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = recurringTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de recurrencia inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, userId)));
    if (!account) {
      return res.status(404).json({ error: "Cuenta no encontrada" });
    }

    if (parsed.data.categoryId) {
      const belongsToUser = await categoryBelongsToUser(userId, parsed.data.categoryId);
      if (!belongsToUser) {
        return res.status(404).json({ error: "Categoría no encontrada" });
      }
    }

    const [created] = await db
      .insert(recurringTransactions)
      .values({
        userId,
        accountId: parsed.data.accountId,
        categoryId: parsed.data.categoryId ?? null,
        type: parsed.data.type,
        amount: parsed.data.amount,
        cadence: parsed.data.cadence,
        intervalCount: parsed.data.intervalCount,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate ?? null,
        payee: parsed.data.payee ?? null,
        memo: parsed.data.memo ?? null,
        flag: parsed.data.flag ?? null,
        autoSettle: parsed.data.autoSettle,
      })
      .returning();

    await syncRecurringTransactions(userId, getRecurringSyncThroughDate());

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

recurringTransactionsRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = recurringTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de recurrencia inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    if (!existing) {
      return res.status(404).json({ error: "Programación recurrente no encontrada" });
    }

    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.userId, userId)));
    if (!account) {
      return res.status(404).json({ error: "Cuenta no encontrada" });
    }

    if (parsed.data.categoryId) {
      const belongsToUser = await categoryBelongsToUser(userId, parsed.data.categoryId);
      if (!belongsToUser) {
        return res.status(404).json({ error: "Categoría no encontrada" });
      }
    }

    // Cambiar la regla y regenerar sus ocurrencias futuras es una sola
    // unidad: a medias, se quedarían ocurrencias pendientes que ya no
    // corresponden a la regla nueva.
    const updated = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(recurringTransactions)
        .set({
          accountId: parsed.data.accountId,
          categoryId: parsed.data.categoryId ?? null,
          type: parsed.data.type,
          amount: parsed.data.amount,
          cadence: parsed.data.cadence,
          intervalCount: parsed.data.intervalCount,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate ?? null,
          payee: parsed.data.payee ?? null,
          memo: parsed.data.memo ?? null,
          flag: parsed.data.flag ?? null,
          autoSettle: parsed.data.autoSettle,
        })
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
        .returning();

      await deletePendingRecurringOccurrences(userId, id, tx);
      await syncRecurringTransactions(userId, getRecurringSyncThroughDate(), tx);

      return updated;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

recurringTransactionsRouter.patch("/:id/active", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = recurringTransactionActiveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de activación inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [existing] = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    if (!existing) {
      return res.status(404).json({ error: "Programación recurrente no encontrada" });
    }

    const updated = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(recurringTransactions)
        .set({ active: parsed.data.active })
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)))
        .returning();

      await deletePendingRecurringOccurrences(userId, id, tx);
      if (parsed.data.active) {
        await syncRecurringTransactions(userId, getRecurringSyncThroughDate(), tx);
      }

      return updated;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

recurringTransactionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    if (!existing) {
      return res.status(404).json({ error: "Programación recurrente no encontrada" });
    }

    await db.transaction(async (tx) => {
      await deletePendingRecurringOccurrences(userId, id, tx);

      await tx
        .delete(recurringTransactions)
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});