import { Router } from "express";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { categoryBelongsToUser } from "../services/budgets.service.js";
import { applySuggestions, deleteRule, listRules, previewRule, updateRule, upsertRule } from "../services/category-rules.service.js";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { normalizeText } from "../utils/text.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";
import { accounts, categoryRules } from "../db/schema.js";

export const categoryRulesRouter = Router();
categoryRulesRouter.param("id", validateIdParam);

categoryRulesRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    res.json({ data: await listRules(userId) });
  } catch (err) {
    next(err);
  }
});

const ruleSchema = z.object({
  match: z
    .string()
    .max(100)
    .refine((v) => normalizeText(v).length >= 2, "Escribe al menos 2 caracteres"),
  categoryId: z.number().int().positive(),
  matchField: z.enum(["payee", "memo", "any"]).default("payee"),
  transactionType: z.enum(["expense", "income"]).nullish(),
  minAmount: z.number().finite().nonnegative().max(1_000_000_000).nullish(),
  maxAmount: z.number().finite().nonnegative().max(1_000_000_000).nullish(),
  accountId: z.number().int().positive().max(2_147_483_647).nullish(),
}).refine((r) => r.minAmount == null || r.maxAmount == null || r.minAmount <= r.maxAmount, {
  message: "El importe mínimo no puede ser mayor que el máximo",
  path: ["maxAmount"],
});

/** La cuenta de una condición tiene que ser del usuario. */
async function accountIsOwned(userId: number, accountId: number | null | undefined): Promise<boolean> {
  if (accountId == null) return true;
  const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return !!row;
}

// Crear una regla (o cambiar la categoría de la que ya existe para ese texto).
categoryRulesRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    await assertUnderLimit(categoryRules, categoryRules.userId, userId, USER_LIMITS.categoryRules, "reglas de categorización");
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await categoryBelongsToUser(userId, parsed.data.categoryId))) {
      return res.status(404).json({ error: "Categoría no encontrada" });
    }
    if (!(await accountIsOwned(userId, parsed.data.accountId))) {
      return res.status(404).json({ error: "Cuenta no encontrada" });
    }
    const { match, categoryId, ...conditions } = parsed.data;
    const rule = await upsertRule(userId, match, categoryId, conditions);
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

// Editar una regla (texto, categoría o condiciones).
categoryRulesRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await categoryBelongsToUser(userId, parsed.data.categoryId))) {
      return res.status(404).json({ error: "Categoría no encontrada" });
    }
    if (!(await accountIsOwned(userId, parsed.data.accountId))) {
      return res.status(404).json({ error: "Cuenta no encontrada" });
    }
    const { match, categoryId, ...conditions } = parsed.data;
    const rule = await updateRule(userId, Number(req.params.id), match, categoryId, conditions);
    if (!rule) return res.status(404).json({ error: "Regla no encontrada" });
    res.json(rule);
  } catch (err) {
    // Otra regla con el mismo texto (índice único por usuario y texto).
    if ((err as { code?: string }).code === "23505") return res.status(409).json({ error: "Ya tienes otra regla con ese texto" });
    next(err);
  }
});

// A qué movimientos afectaría una regla, antes de guardarla.
categoryRulesRouter.post("/preview", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await previewRule(userId, parsed.data));
  } catch (err) {
    next(err);
  }
});

categoryRulesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const removed = await deleteRule(userId, Number(req.params.id));
    if (!removed) return res.status(404).json({ error: "Regla no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const applySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500).optional(),
});

// Categorizar de golpe los movimientos sin categoría (todos, o solo `ids`) con las reglas y el historial.
categoryRulesRouter.post("/apply", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = applySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await applySuggestions(userId, parsed.data.ids));
  } catch (err) {
    next(err);
  }
});
