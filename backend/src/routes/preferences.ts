import { Router } from "express";
import { deletePreference, listPreferences, setPreference } from "../services/preferences.service.js";

export const preferencesRouter = Router();

// Todas las preferencias del usuario ({ clave: valor }).
preferencesRouter.get("/", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    res.json({ data: await listPreferences(userId) });
  } catch (err) {
    next(err);
  }
});

// Guardar una preferencia: el cuerpo es `{ "value": <JSON> }`.
preferencesRouter.put("/:key", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    if (!req.body || typeof req.body !== "object" || !("value" in req.body)) {
      return res.status(400).json({ error: "Falta el valor" });
    }
    const result = await setPreference(userId, req.params.key, (req.body as { value: unknown }).value);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

preferencesRouter.delete("/:key", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const removed = await deletePreference(userId, req.params.key);
    if (!removed) return res.status(404).json({ error: "Preferencia no encontrada" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
