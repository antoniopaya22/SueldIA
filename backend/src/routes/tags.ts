import { Router } from "express";
import { db } from "../db/index.js";
import { tags, payslipTags } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { userOwnsPayslip } from "../utils/ownership.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";

export const tagsRouter = Router();
tagsRouter.param("id", validateIdParam);
tagsRouter.param("payslipId", validateIdParam);
tagsRouter.param("tagId", validateIdParam);

const tagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

// List all tags
tagsRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const allTags = await db.select().from(tags).where(eq(tags.userId, userId)).orderBy(tags.name);
    res.json(allTags);
  } catch (err) {
    next(err);
  }
});

// Create tag
tagsRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    await assertUnderLimit(tags, tags.userId, userId, USER_LIMITS.tags, "etiquetas");
    const parsed = tagSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }

    const [tag] = await db.insert(tags).values({ ...parsed.data, userId }).returning();
    res.status(201).json(tag);
  } catch (err) {
    next(err);
  }
});

// Renombrar o cambiar el color de una etiqueta
tagsRouter.patch("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = tagSchema.partial().refine((v) => v.name !== undefined || v.color !== undefined, "Nada que cambiar").safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const [tag] = await db
      .update(tags)
      .set(parsed.data)
      .where(and(eq(tags.id, Number(req.params.id)), eq(tags.userId, userId)))
      .returning();
    if (!tag) return res.status(404).json({ error: "Etiqueta no encontrada" });
    res.json(tag);
  } catch (err) {
    next(err);
  }
});

// Delete tag
tagsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [deleted] = await db.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, userId))).returning();
    if (!deleted) return res.status(404).json({ error: "Etiqueta no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Assign tag to payslip
tagsRouter.post("/assign", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const schema = z.object({ payslipId: z.number().int().positive(), tagId: z.number().int().positive() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await userOwnsPayslip(userId, parsed.data.payslipId))) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }
    const [tag] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, parsed.data.tagId), eq(tags.userId, userId)));
    if (!tag) return res.status(404).json({ error: "Etiqueta no encontrada" });

    // onConflictDoNothing: asignar dos veces la misma etiqueta (doble clic)
    // ya no puede duplicar la fila (payslip_tags tiene ahora una clave
    // única) — si ya existía, se devuelve tal cual en vez de dar un 500.
    const [entry] = await db
      .insert(payslipTags)
      .values(parsed.data)
      .onConflictDoNothing({ target: [payslipTags.payslipId, payslipTags.tagId] })
      .returning();
    if (entry) return res.status(201).json(entry);

    const [existing] = await db
      .select()
      .from(payslipTags)
      .where(and(eq(payslipTags.payslipId, parsed.data.payslipId), eq(payslipTags.tagId, parsed.data.tagId)));
    res.status(200).json(existing);
  } catch (err) {
    next(err);
  }
});

// Remove tag from payslip
tagsRouter.delete("/assign/:payslipId/:tagId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const payslipId = Number(req.params.payslipId);
    const tagId = Number(req.params.tagId);
    if (!(await userOwnsPayslip(userId, payslipId))) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }
    await db
      .delete(payslipTags)
      .where(and(eq(payslipTags.payslipId, payslipId), eq(payslipTags.tagId, tagId)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Get tags for a payslip
tagsRouter.get("/payslip/:payslipId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const payslipId = Number(req.params.payslipId);
    if (!(await userOwnsPayslip(userId, payslipId))) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }
    const entries = await db
      .select({ tag: tags })
      .from(payslipTags)
      .innerJoin(tags, eq(payslipTags.tagId, tags.id))
      .where(eq(payslipTags.payslipId, payslipId));
    res.json(entries.map((e) => e.tag));
  } catch (err) {
    next(err);
  }
});
