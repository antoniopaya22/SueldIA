import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { accounts, savingsGoals } from "../db/schema.js";
import { validateIdParam } from "../middleware/params.js";
import { listGoals } from "../services/savings-goals.service.js";
import { isoDateSchema } from "../utils/dates.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";
import { moneySchema, positiveMoneySchema } from "../utils/validation.js";

export const savingsGoalsRouter = Router();
savingsGoalsRouter.param("id", validateIdParam);

const goalSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre").max(100),
  targetAmount: positiveMoneySchema("El objetivo debe ser mayor que cero"),
  targetDate: isoDateSchema.nullish(),
  accountId: z.number().int().positive().nullish(),
  savedAmount: moneySchema.min(0, "No puede ser negativo").optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  archived: z.boolean().optional(),
});

async function accountIsUsers(userId: number, accountId: number | null | undefined): Promise<boolean> {
  if (accountId == null) return true;
  const [row] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  return Boolean(row);
}

savingsGoalsRouter.get("/", async (req, res, next) => {
  try {
    res.json({ data: await listGoals(req.user!.userId) });
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = goalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    await assertUnderLimit(savingsGoals, savingsGoals.userId, userId, USER_LIMITS.savingsGoals, "objetivos");
    if (!(await accountIsUsers(userId, parsed.data.accountId))) return res.status(404).json({ error: "Cuenta no encontrada" });
    const [goal] = await db.insert(savingsGoals).values({ ...parsed.data, userId }).returning();
    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.patch("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = goalSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    if (!(await accountIsUsers(userId, parsed.data.accountId))) return res.status(404).json({ error: "Cuenta no encontrada" });
    const [goal] = await db
      .update(savingsGoals)
      .set(parsed.data)
      .where(and(eq(savingsGoals.id, Number(req.params.id)), eq(savingsGoals.userId, userId)))
      .returning();
    if (!goal) return res.status(404).json({ error: "Objetivo no encontrado" });
    res.json(goal);
  } catch (err) {
    next(err);
  }
});

savingsGoalsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const [goal] = await db
      .delete(savingsGoals)
      .where(and(eq(savingsGoals.id, Number(req.params.id)), eq(savingsGoals.userId, userId)))
      .returning();
    if (!goal) return res.status(404).json({ error: "Objetivo no encontrado" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
