import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { logger } from "../logger.js";

// Errores del navegador (ErrorBoundary, window.onerror, promesas sin capturar)
// → logs del backend, visibles en Vercel. Sin esto, un fallo de la interfaz
// solo quedaba en la consola de quien lo sufría. No sustituye a un servicio
// de errores (Sentry…), pero no depende de ninguno.
export const clientErrorsRouter = Router();

const reportSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(4000).optional(),
  url: z.string().max(500),
  source: z.enum(["boundary", "window", "promise"]),
});

clientErrorsRouter.post(
  "/",
  // Un bucle de errores en una pestaña no puede inundar los logs.
  rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }),
  (req, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });
    // Solo la ruta, sin query: los parámetros pueden llevar búsquedas del usuario.
    const path = (() => {
      try {
        return new URL(parsed.data.url).pathname;
      } catch {
        return "";
      }
    })();
    logger.warn({ userId: req.user?.userId, ...parsed.data, url: path, userAgent: req.headers["user-agent"] }, "Error en el navegador");
    res.status(204).end();
  },
);
