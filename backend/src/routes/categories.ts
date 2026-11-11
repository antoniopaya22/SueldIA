import { Router } from "express";
import { db } from "../db/index.js";
import { categoryGroups, categories } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { seedDefaultCategories } from "../services/default-categories.service.js";
import {
  deleteCategories, getCategoryUsage, ownedCategoryGroupId, ownedGroupCategoryIds,
} from "../services/category-deletion.service.js";

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

// ?reassignTo=<id de categoría>: mover movimientos, recurrentes, reglas y
// presupuesto a esa categoría antes de borrar. Sin él, se pierden (los
// movimientos quedan sin categoría).
const reassignQuery = z.object({ reassignTo: z.coerce.number().int().positive().max(2_147_483_647).optional() });

/** Valida `reassignTo`: categoría del usuario y fuera de lo que se borra. */
async function resolveReassign(
  userId: number,
  raw: unknown,
  deleting: number[],
): Promise<{ ok: true; reassignTo: number | null } | { ok: false; error: string }> {
  const parsed = reassignQuery.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Categoría de destino no válida" };
  const target = parsed.data.reassignTo;
  if (target === undefined) return { ok: true, reassignTo: null };
  if (deleting.includes(target)) return { ok: false, error: "La categoría de destino no puede ser una de las que se eliminan" };
  if ((await ownedCategoryGroupId(userId, target)) === null) return { ok: false, error: "Categoría de destino no encontrada" };
  return { ok: true, reassignTo: target };
}

// Qué se vería afectado al borrar el grupo (para el diálogo de confirmación).
categoriesRouter.get("/groups/:id/usage", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const ids = await ownedGroupCategoryIds(userId, Number(req.params.id));
    if (!ids) return res.status(404).json({ error: "Grupo no encontrado" });
    res.json({ categories: ids.length, ...(await getCategoryUsage(userId, ids)) });
  } catch (err) {
    next(err);
  }
});

// Delete category group (cascades to categories)
categoriesRouter.delete("/groups/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const ids = await ownedGroupCategoryIds(userId, id);
    if (!ids) return res.status(404).json({ error: "Grupo no encontrado" });
    const target = await resolveReassign(userId, req.query, ids);
    if (!target.ok) return res.status(400).json({ error: target.error });
    await deleteCategories(userId, ids, target.reassignTo, id);
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

// Qué se vería afectado al borrar la categoría.
categoriesRouter.get("/:id/usage", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    if ((await ownedCategoryGroupId(userId, id)) === null) return res.status(404).json({ error: "Categoría no encontrada" });
    res.json(await getCategoryUsage(userId, [id]));
  } catch (err) {
    next(err);
  }
});

// Delete category
categoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    // Propiedad a través del grupo (categories no tiene user_id propio).
    if ((await ownedCategoryGroupId(userId, id)) === null) return res.status(404).json({ error: "Categoría no encontrada" });
    const target = await resolveReassign(userId, req.query, [id]);
    if (!target.ok) return res.status(400).json({ error: target.error });

    await deleteCategories(userId, [id], target.reassignTo);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
