import { Router } from "express";
import { z } from "zod";
import { listActivity } from "../services/activity.service.js";

export const activityRouter = Router();

const querySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Registro de actividad del usuario, de lo más reciente a lo más antiguo
// (paginado con `before` = id de la última fila vista).
activityRouter.get("/", async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parámetros de consulta inválidos", details: parsed.error.flatten().fieldErrors });
    }
    res.json(await listActivity(req.user!.userId, parsed.data));
  } catch (err) {
    next(err);
  }
});
