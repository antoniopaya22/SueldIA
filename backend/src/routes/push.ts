import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { notifyUser, pushEnabled, removeSubscription, saveSubscription } from "../services/push.service.js";

export const pushRouter = Router();

// Los servicios de push de los navegadores son siempre https; los campos son base64url.
const b64url = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+=*$/);
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine((u) => u.startsWith("https://"), "Dirección de notificaciones no válida"),
  keys: z.object({ p256dh: b64url, auth: b64url }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().max(2048) });

const notConfigured = { error: "Las notificaciones no están disponibles en este servidor" };

/** Clave pública VAPID para que el navegador se suscriba. */
pushRouter.get("/key", (_req, res) => {
  if (!pushEnabled()) return res.status(503).json(notConfigured);
  res.json({ publicKey: env.VAPID_PUBLIC_KEY });
});

pushRouter.post("/subscriptions", async (req, res, next) => {
  try {
    if (!pushEnabled()) return res.status(503).json(notConfigured);
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Suscripción no válida", details: parsed.error.flatten().fieldErrors });
    await saveSubscription(req.user!.userId, parsed.data);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

pushRouter.delete("/subscriptions", async (req, res, next) => {
  try {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });
    await removeSubscription(req.user!.userId, parsed.data.endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Aviso de prueba a los dispositivos del usuario (Ajustes → «Enviar una de prueba»). */
pushRouter.post("/test", async (req, res, next) => {
  try {
    if (!pushEnabled()) return res.status(503).json(notConfigured);
    const sent = await notifyUser(req.user!.userId, {
      title: "SueldIA",
      body: "Las notificaciones funcionan en este dispositivo.",
      url: "/app/settings",
      tag: "sueldia-test",
    });
    res.json({ sent });
  } catch (err) {
    next(err);
  }
});
