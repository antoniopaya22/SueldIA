import { Router } from "express";
import { db } from "../db/index.js";
import { payslipNotes, payslips, profiles } from "../db/schema.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { userOwnsPayslip } from "../utils/ownership.js";
import { assertUnderLimit, USER_LIMITS } from "../utils/limits.js";

export const notesRouter = Router();
notesRouter.param("id", validateIdParam);
notesRouter.param("payslipId", validateIdParam);

const noteSchema = z.object({
  payslipId: z.number().int().positive(),
  content: z.string().min(1).max(2000),
});

// Get notes for a payslip
notesRouter.get("/:payslipId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const payslipId = Number(req.params.payslipId);
    if (!(await userOwnsPayslip(userId, payslipId))) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }
    const notes = await db
      .select()
      .from(payslipNotes)
      .where(eq(payslipNotes.payslipId, payslipId))
      .orderBy(desc(payslipNotes.createdAt));
    res.json(notes);
  } catch (err) {
    next(err);
  }
});

// Add note
notesRouter.post("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    if (!(await userOwnsPayslip(userId, parsed.data.payslipId))) {
      return res.status(404).json({ error: "Nómina no encontrada" });
    }
    await assertUnderLimit(payslipNotes, payslipNotes.payslipId, parsed.data.payslipId, USER_LIMITS.notesPerPayslip, "notas en esta nómina");

    const [note] = await db.insert(payslipNotes).values(parsed.data).returning();
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

// Editar una nota
notesRouter.patch("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = noteSchema.pick({ content: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }
    const ownedPayslipIds = db
      .select({ id: payslips.id })
      .from(payslips)
      .innerJoin(profiles, eq(payslips.profileId, profiles.id))
      .where(eq(profiles.userId, userId));
    const [note] = await db
      .update(payslipNotes)
      .set({ content: parsed.data.content })
      .where(and(eq(payslipNotes.id, Number(req.params.id)), inArray(payslipNotes.payslipId, ownedPayslipIds)))
      .returning();
    if (!note) return res.status(404).json({ error: "Nota no encontrada" });
    res.json(note);
  } catch (err) {
    next(err);
  }
});

// Delete note
notesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);
    const ownedPayslipIds = db
      .select({ id: payslips.id })
      .from(payslips)
      .innerJoin(profiles, eq(payslips.profileId, profiles.id))
      .where(eq(profiles.userId, userId));
    const [deleted] = await db
      .delete(payslipNotes)
      .where(and(eq(payslipNotes.id, id), inArray(payslipNotes.payslipId, ownedPayslipIds)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Nota no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
