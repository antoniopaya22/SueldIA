import { Router } from "express";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { eq, and, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { getAccountsWithBalance } from "../services/finance.service.js";

export const accountsRouter = Router();
accountsRouter.param("id", validateIdParam);

const accountSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  type: z.enum(["bank", "credit_card", "cash", "investment", "other"]).optional(),
  currency: z.string().max(10).optional(),
  initialBalance: z.number().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).nullish(),
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
      return res.status(400).json({ error: "Orden de cuentas inválido", details: parsed.error.flatten() });
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
