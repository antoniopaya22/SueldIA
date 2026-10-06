import { Router } from "express";
import { db } from "../db/index.js";
import { alertRules, alertHistory } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { alertConfigSchemas, evaluateRulesForUser, type AlertRuleType } from "../services/alerts.service.js";

export const alertsRouter = Router();
alertsRouter.param("id", validateIdParam);

const ruleTypeSchema = z.enum([
  "salary_drop", "missing_payslip", "concept_change", "custom_threshold",
  "category_overspent", "low_balance", "overdue_pending",
]);

/** Valida `config` contra el esquema propio de `type` (ver alerts.service.ts). */
function parseConfigForType(type: AlertRuleType, config: unknown) {
  return alertConfigSchemas[type].safeParse(config);
}

const baseRuleSchema = z.object({
  name: z.string().min(1).max(100),
  type: ruleTypeSchema,
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

// List alert rules
alertsRouter.get("/rules", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const rules = await db.select().from(alertRules)
      .where(eq(alertRules.userId, userId))
      .orderBy(desc(alertRules.createdAt));
    res.json(rules.map((r) => ({ ...r, config: JSON.parse(r.config) })));
  } catch (err) {
    next(err);
  }
});

// Create alert rule
alertsRouter.post("/rules", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = baseRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }

    const configResult = parseConfigForType(parsed.data.type, parsed.data.config);
    if (!configResult.success) {
      return res.status(400).json({
        error: "Configuración inválida para este tipo de regla",
        details: configResult.error.flatten().fieldErrors,
      });
    }

    const [rule] = await db
      .insert(alertRules)
      .values({ ...parsed.data, config: JSON.stringify(parsed.data.config), userId })
      .returning();

    // Evaluación inmediata: si la condición ya se cumple con los datos que
    // hay hoy, el usuario ve la alerta nada más crear la regla, sin esperar
    // al cron diario.
    evaluateRulesForUser(userId).catch(() => {});

    res.status(201).json({ ...rule, config: JSON.parse(rule.config) });
  } catch (err) {
    next(err);
  }
});

// Update alert rule
alertsRouter.put("/rules/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    const [existing] = await db
      .select()
      .from(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)));
    if (!existing) return res.status(404).json({ error: "Regla no encontrada" });

    const parsed = baseRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }

    const effectiveType = (parsed.data.type ?? existing.type) as AlertRuleType;
    if (parsed.data.config !== undefined) {
      const configResult = parseConfigForType(effectiveType, parsed.data.config);
      if (!configResult.success) {
        return res.status(400).json({
          error: "Configuración inválida para este tipo de regla",
          details: configResult.error.flatten().fieldErrors,
        });
      }
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (data.config) data.config = JSON.stringify(data.config);

    const [updated] = await db.update(alertRules).set(data)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Regla no encontrada" });

    evaluateRulesForUser(userId).catch(() => {});

    res.json({ ...updated, config: JSON.parse(updated.config) });
  } catch (err) {
    next(err);
  }
});

// Delete alert rule
alertsRouter.delete("/rules/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [deleted] = await db.delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.userId, userId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Regla no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// List alert history
alertsRouter.get("/history", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const unreadOnly = req.query.unread === "true";
    const conditions = unreadOnly
      ? and(eq(alertHistory.userId, userId), eq(alertHistory.read, false))
      : eq(alertHistory.userId, userId);

    const history = await db
      .select()
      .from(alertHistory)
      .where(conditions)
      .orderBy(desc(alertHistory.createdAt))
      .limit(50);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// Mark alert as read
alertsRouter.put("/history/:id/read", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [updated] = await db
      .update(alertHistory)
      .set({ read: true })
      .where(and(eq(alertHistory.id, id), eq(alertHistory.userId, userId)))
      .returning({ id: alertHistory.id });
    if (!updated) return res.status(404).json({ error: "Alerta no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Mark all alerts as read
alertsRouter.put("/history/read-all", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    await db
      .update(alertHistory)
      .set({ read: true })
      .where(and(eq(alertHistory.userId, userId), eq(alertHistory.read, false)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
