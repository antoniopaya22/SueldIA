import { Router } from "express";
import { z } from "zod";
import {
  autoAssign, categoryBelongsToUser, deleteTarget, getBudgetSummary, moveBetweenCategories, upsertBudget, upsertTarget,
} from "../services/budgets.service.js";

export const budgetsRouter = Router();

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM");

// Resumen del mes: para presupuestar, y asignado/actividad/disponible por categoría.
budgetsRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = monthSchema.safeParse(req.query.month);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parámetro month inválido (usa YYYY-MM)" });
    }

    const summary = await getBudgetSummary(userId, parsed.data);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

const upsertSchema = z.object({
  categoryId: z.number().int().positive(),
  month: monthSchema,
  assigned: z.number(),
});

// Asignar (o reasignar) un importe a una categoría en un mes — upsert.
budgetsRouter.put("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }

    const belongsToUser = await categoryBelongsToUser(userId, parsed.data.categoryId);
    if (!belongsToUser) return res.status(404).json({ error: "Categoría no encontrada" });

    const row = await upsertBudget(userId, parsed.data.categoryId, parsed.data.month, parsed.data.assigned);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ─── Objetivos por categoría ────────────────────────────────────

const targetSchema = z
  .object({
    categoryId: z.number().int().positive(),
    type: z.enum(["monthly", "by_date"]),
    amount: z.number().positive("El objetivo debe ser mayor que cero").max(1_000_000_000),
    targetMonth: monthSchema.nullish(),
  })
  .refine((t) => t.type === "monthly" || !!t.targetMonth, {
    message: "Indica el mes límite del objetivo",
    path: ["targetMonth"],
  });

// Crear o cambiar el objetivo de una categoría (como mucho uno por categoría).
budgetsRouter.put("/targets", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = targetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await categoryBelongsToUser(userId, parsed.data.categoryId))) {
      return res.status(404).json({ error: "Categoría no encontrada" });
    }
    const { categoryId, type, amount, targetMonth } = parsed.data;
    const row = await upsertTarget(userId, categoryId, {
      type,
      amount,
      targetMonth: type === "by_date" ? targetMonth ?? null : null,
    });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

budgetsRouter.delete("/targets/:categoryId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const categoryId = z.coerce.number().int().positive().safeParse(req.params.categoryId);
    if (!categoryId.success) return res.status(400).json({ error: "Categoría inválida" });
    const removed = await deleteTarget(userId, categoryId.data);
    if (!removed) return res.status(404).json({ error: "Esa categoría no tiene objetivo" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Asignación rápida y mover dinero ───────────────────────────

const autoAssignSchema = z.object({
  month: monthSchema,
  mode: z.enum(["copy-previous", "average-3", "targets"]),
});

// Asignar de golpe: copiar el mes anterior, la media de gasto de 3 meses o lo que falta para los objetivos.
budgetsRouter.post("/auto-assign", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = autoAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await autoAssign(userId, parsed.data.month, parsed.data.mode));
  } catch (err) {
    next(err);
  }
});

const moveSchema = z.object({
  month: monthSchema,
  fromCategoryId: z.number().int().positive(),
  toCategoryId: z.number().int().positive(),
  amount: z.number().positive("El importe debe ser mayor que cero").max(1_000_000_000),
});

// Pasar dinero disponible de una categoría a otra (p. ej. para cubrir un sobregasto).
budgetsRouter.post("/move", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const { month, fromCategoryId, toCategoryId, amount } = parsed.data;
    const result = await moveBetweenCategories(userId, month, fromCategoryId, toCategoryId, amount);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
