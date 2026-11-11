import { Router } from "express";
import { db } from "../db/index.js";
import { accounts, accountValuations } from "../db/schema.js";
import { eq, and, inArray, max, asc } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { getAccountsWithBalance } from "../services/finance.service.js";
import { moneySchema } from "../utils/validation.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";
import { clearedBalance, reconcileAccount } from "../services/reconcile.service.js";
import { amortizationSchedule, loanPosition } from "../services/loans.service.js";
import { getTodayIsoDate } from "../services/recurring-transactions.service.js";
import { isoDateSchema } from "../utils/dates.js";

export const accountsRouter = Router();
accountsRouter.param("id", validateIdParam);

const accountSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  type: z.enum(["bank", "credit_card", "cash", "investment", "loan", "mortgage", "other"]).optional(),
  // Todo se suma y se muestra en euros: no hay conversión entre divisas, así
  // que no se admite otra (antes se guardaba cualquier texto y la tarjeta lo
  // mostraba, como si existiera).
  currency: z.literal("EUR").optional(),
  initialBalance: moneySchema.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).nullish(),
  // Préstamo o hipoteca: datos para el cuadro de amortización (opcionales).
  loanPrincipal: z.number().positive().max(100_000_000).nullish(),
  loanRate: z.number().min(0).max(50).nullish(),
  loanTermMonths: z.number().int().min(1).max(600).nullish(),
  loanStartDate: isoDateSchema.nullish(),
});

// List all accounts with calculated balance
accountsRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const result = await getAccountsWithBalance(userId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Reordenar: `ids` en el orden deseado; cada una recibe su posición. Las que
// no vengan conservan la suya. Va antes de las rutas con :id.
const orderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200)
    .refine((ids) => new Set(ids).size === ids.length, "Hay cuentas repetidas"),
});

accountsRouter.put("/order", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Orden de cuentas inválido", details: parsed.error.flatten().fieldErrors });
    }
    const { ids } = parsed.data;
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.id, ids)));
    if (owned.length !== ids.length) return res.status(404).json({ error: "Cuenta no encontrada" });

    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx
          .update(accounts)
          .set({ sortOrder: index })
          .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Cuadro de amortización (préstamo o hipoteca con sus datos completos).
accountsRouter.get("/:id/amortization", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const [account] = await db.select().from(accounts).where(and(eq(accounts.id, Number(req.params.id)), eq(accounts.userId, userId)));
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });
    const { loanPrincipal, loanRate, loanTermMonths, loanStartDate } = account;
    if (loanPrincipal == null || loanRate == null || loanTermMonths == null || loanStartDate == null) {
      return res.status(409).json({ error: "Faltan los datos del préstamo: importe, interés, plazo y primera cuota" });
    }
    const rows = amortizationSchedule({ principal: loanPrincipal, annualRate: loanRate, months: loanTermMonths, firstPaymentDate: loanStartDate });
    res.json({
      payment: rows[0]?.payment ?? 0,
      totalInterest: Math.round(rows.reduce((s, r) => s + r.interest, 0) * 100) / 100,
      position: loanPosition(rows, loanPrincipal, getTodayIsoDate()),
      rows,
    });
  } catch (err) {
    next(err);
  }
});

// Valoraciones (inversiones): «actualizar valor» sin crear un movimiento.
async function ownAccount(userId: number, id: number) {
  const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
  return !!row;
}

accountsRouter.get("/:id/valuations", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    if (!(await ownAccount(userId, id))) return res.status(404).json({ error: "Cuenta no encontrada" });
    const rows = await db
      .select({ id: accountValuations.id, date: accountValuations.date, value: accountValuations.value })
      .from(accountValuations)
      .where(and(eq(accountValuations.accountId, id), eq(accountValuations.userId, userId)))
      .orderBy(asc(accountValuations.date));
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

const valuationSchema = z.object({
  value: moneySchema,
  date: isoDateSchema.optional(),
});

accountsRouter.post("/:id/valuations", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = valuationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valoración inválida", details: parsed.error.flatten().fieldErrors });
    }
    const today = getTodayIsoDate();
    const date = parsed.data.date ?? today;
    // Una valoración futura cambiaría el saldo de hoy por algo que aún no se sabe.
    if (date > today) return res.status(400).json({ error: "La fecha de la valoración no puede ser futura" });
    if (!(await ownAccount(userId, id))) return res.status(404).json({ error: "Cuenta no encontrada" });
    const [row] = await db
      .insert(accountValuations)
      .values({ userId, accountId: id, date, value: parsed.data.value })
      .onConflictDoUpdate({ target: [accountValuations.accountId, accountValuations.date], set: { value: parsed.data.value } })
      .returning({ id: accountValuations.id, date: accountValuations.date, value: accountValuations.value });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/:id/valuations/:valuationId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const valuationId = Number(req.params.valuationId);
    if (!Number.isInteger(valuationId) || valuationId <= 0) return res.status(400).json({ error: "Identificador inválido" });
    const deleted = await db
      .delete(accountValuations)
      .where(and(eq(accountValuations.id, valuationId), eq(accountValuations.accountId, Number(req.params.id)), eq(accountValuations.userId, userId)))
      .returning({ id: accountValuations.id });
    if (!deleted.length) return res.status(404).json({ error: "Valoración no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Get single account
accountsRouter.get("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// Create account
accountsRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    await assertUnderLimit(accounts, accounts.userId, userId, USER_LIMITS.accounts, "cuentas");
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de cuenta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // Las cuentas nuevas van al final del orden elegido.
    const [last] = await db
      .select({ value: max(accounts.sortOrder) })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    const [account] = await db
      .insert(accounts)
      .values({ ...parsed.data, userId, sortOrder: (last?.value ?? -1) + 1 })
      .returning();
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

// Update account
accountsRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de cuenta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [updated] = await db
      .update(accounts)
      .set(parsed.data)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete account
accountsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Toggle archive status
accountsRouter.patch("/:id/archive", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const [account] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });

    const [updated] = await db
      .update(accounts)
      .set({ archived: !account.archived })
      .where(eq(accounts.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Saldo liquidado de la cuenta, para el diálogo de conciliación.
accountsRouter.get("/:id/reconcile", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const balance = await clearedBalance(userId, Number(req.params.id));
    if (balance === null) return res.status(404).json({ error: "Cuenta no encontrada" });
    res.json({ clearedBalance: balance });
  } catch (err) {
    next(err);
  }
});

const reconcileSchema = z.object({
  statementBalance: moneySchema,
  /** Si el saldo no cuadra: crear un movimiento de ajuste por la diferencia. */
  createAdjustment: z.boolean().default(false),
});

accountsRouter.post("/:id/reconcile", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = reconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos de conciliación inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const result = await reconcileAccount(userId, Number(req.params.id), parsed.data.statementBalance, parsed.data.createAdjustment);
    if (!result) return res.status(404).json({ error: "Cuenta no encontrada" });
    // Sin cuadrar y sin ajuste: 409 con la diferencia, para que la interfaz la muestre.
    if (!result.ok) return res.status(409).json({ error: "El saldo no cuadra", difference: result.difference });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
