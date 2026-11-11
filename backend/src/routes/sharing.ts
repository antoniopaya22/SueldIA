import { Router } from "express";
import { z } from "zod";
import { acceptInvite, createInvite, deleteInvite, getSharing, removeShare } from "../services/sharing.service.js";

// Compartir tus datos en solo lectura (siempre con la identidad propia: ver
// OWN_IDENTITY en middleware/auth.ts).
export const sharingRouter = Router();

const idSchema = z.coerce.number().int().positive().max(2_147_483_647);

sharingRouter.get("/", async (req, res, next) => {
  try {
    res.json(await getSharing(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

sharingRouter.post("/invites", async (req, res, next) => {
  try {
    res.status(201).json(await createInvite(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

sharingRouter.delete("/invites/:id", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido" });
    if (!(await deleteInvite(req.user!.userId, id.data))) return res.status(404).json({ error: "Invitación no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const acceptSchema = z.object({ token: z.string().min(16).max(100) });

sharingRouter.post("/accept", async (req, res, next) => {
  try {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Código de invitación inválido", details: parsed.error.flatten().fieldErrors });
    res.json({ owner: await acceptInvite(req.user!.userId, parsed.data.token) });
  } catch (err) {
    next(err);
  }
});

// El titular quita el acceso a alguien.
sharingRouter.delete("/viewers/:userId", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.userId);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido" });
    if (!(await removeShare(req.user!.userId, id.data))) return res.status(404).json({ error: "Esa persona no tiene acceso" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Quien ve deja de ver los datos de un titular.
sharingRouter.delete("/owners/:userId", async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.userId);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido" });
    if (!(await removeShare(id.data, req.user!.userId))) return res.status(404).json({ error: "No tenías acceso a esos datos" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
