import { Router } from "express";
import { db } from "../db/index.js";
import { categoryGroups, categories } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { seedDefaultCategories } from "../services/default-categories.service.js";

export const categoriesRouter = Router();
categoriesRouter.param("id", validateIdParam);

const groupSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  icon: z.string().max(50).nullish(),
  sortOrder: z.number().int().optional(),
});

const categorySchema = z.object({
  groupId: z.number().int().positive("Grupo requerido"),
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  sortOrder: z.number().int().optional(),
});

// List all groups with nested categories
categoriesRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;

    const groups = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.userId, userId))
      .orderBy(categoryGroups.sortOrder, categoryGroups.name);

    const catRows = await db
      .select({ category: categories })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(eq(categoryGroups.userId, userId))
      .orderBy(categories.sortOrder, categories.name);
    const cats = catRows.map((r) => r.category);

    const groupMap = groups.map((g) => ({
      ...g,
      categories: cats.filter((c) => c.groupId === g.id),
    }));

    res.json({ data: groupMap });
  } catch (err) {
    next(err);
  }
});

// Crear las categorías de partida (en español) que aún no tenga. Idempotente.
categoriesRouter.post("/seed-defaults", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    res.status(201).json(await seedDefaultCategories(userId));
  } catch (err) {
    next(err);
  }
});

// Create category group
categoriesRouter.post("/groups", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de grupo inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [group] = await db
      .insert(categoryGroups)
      .values({ ...parsed.data, userId })
      .returning();
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

// Update category group
categoriesRouter.put("/groups/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de grupo inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [updated] = await db
      .update(categoryGroups)
      .set(parsed.data)
      .where(and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Grupo no encontrado" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete category group (cascades to categories)
categoriesRouter.delete("/groups/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(categoryGroups)
      .where(and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Grupo no encontrado" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Create category
categoriesRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos de categoría inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // Verify group belongs to user
    const [group] = await db
      .select()
      .from(categoryGroups)
      .where(and(eq(categoryGroups.id, parsed.data.groupId), eq(categoryGroups.userId, userId)));
    if (!group) return res.status(404).json({ error: "Grupo no encontrado" });

    const [category] = await db
      .insert(categories)
      .values(parsed.data)
      .returning();
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

// Update category
categoriesRouter.put("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      groupId: z.number().int().positive().optional(),
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: "Datos inválidos",
        details: body.error.flatten().fieldErrors,
      });
    }

    // Verify category's group belongs to user
    const [existing] = await db.select().from(categories).where(eq(categories.id, id));
    if (!existing) return res.status(404).json({ error: "Categoría no encontrada" });

    const [group] = await db
      .select()
      .from(categoryGroups)
      .where(and(eq(categoryGroups.id, existing.groupId), eq(categoryGroups.userId, userId)));
    if (!group) return res.status(404).json({ error: "Categoría no encontrada" });

    // If moving to another group, verify that too
    if (body.data.groupId && body.data.groupId !== existing.groupId) {
      const [newGroup] = await db
        .select()
        .from(categoryGroups)
        .where(and(eq(categoryGroups.id, body.data.groupId), eq(categoryGroups.userId, userId)));
      if (!newGroup) return res.status(404).json({ error: "Grupo destino no encontrado" });
    }

    const [updated] = await db
      .update(categories)
      .set(body.data)
      .where(eq(categories.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Delete category
categoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    // Verify ownership via group
    const [existing] = await db.select().from(categories).where(eq(categories.id, id));
    if (!existing) return res.status(404).json({ error: "Categoría no encontrada" });

    const [group] = await db
      .select()
      .from(categoryGroups)
      .where(and(eq(categoryGroups.id, existing.groupId), eq(categoryGroups.userId, userId)));
    if (!group) return res.status(404).json({ error: "Categoría no encontrada" });

    await db.delete(categories).where(eq(categories.id, id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
