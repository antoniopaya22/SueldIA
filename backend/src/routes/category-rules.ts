import { Router } from "express";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { categoryBelongsToUser } from "../services/budgets.service.js";
import { applySuggestions, deleteRule, listRules, upsertRule } from "../services/category-rules.service.js";
import { normalizeText } from "../utils/text.js";

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
});

// Crear una regla (o cambiar la categoría de la que ya existe para ese texto).
categoryRulesRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await categoryBelongsToUser(userId, parsed.data.categoryId))) {
      return res.status(404).json({ error: "Categoría no encontrada" });
    }
    const rule = await upsertRule(userId, parsed.data.match, parsed.data.categoryId);
    res.status(201).json(rule);
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
