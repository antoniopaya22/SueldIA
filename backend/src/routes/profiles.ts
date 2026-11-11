import { Router } from "express";
import { db } from "../db/index.js";
import { profiles } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";

export const profilesRouter = Router();
profilesRouter.param("id", validateIdParam);

const profileSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

// List all profiles (with optional pagination)
profilesRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .where(eq(profiles.userId, userId));

    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .orderBy(profiles.name)
      .limit(limit)
      .offset(offset);

    res.json({ data: result, total: count, page, limit });
  } catch (err) {
    next(err);
  }
});

// Get single profile
profilesRouter.get("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [profile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.id, id), eq(profiles.userId, userId)));
    if (!profile) return res.status(404).json({ error: "Perfil no encontrado" });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Create profile
profilesRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    await assertUnderLimit(profiles, profiles.userId, userId, USER_LIMITS.profiles, "perfiles");
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Datos de perfil inválidos", details: parsed.error.flatten().fieldErrors });

    const [profile] = await db
      .insert(profiles)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
});

// Update profile
profilesRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Datos de perfil inválidos", details: parsed.error.flatten().fieldErrors });

    const [updated] = await db
      .update(profiles)
      .set(parsed.data)
      .where(and(eq(profiles.id, id), eq(profiles.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Perfil no encontrado" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete profile
profilesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(profiles)
      .where(and(eq(profiles.id, id), eq(profiles.userId, userId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Perfil no encontrado" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
