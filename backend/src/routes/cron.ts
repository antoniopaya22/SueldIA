import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pruneActivity } from "../services/activity.service.js";
import { env } from "../config.js";
import { logger } from "../logger.js";
import { evaluateAllRules } from "../services/alerts.service.js";
import { syncAllUsersRecurringTransactions } from "../services/recurring-transactions.service.js";

export const cronRouter = Router();

// Comparación en tiempo constante: `!==` delata cuántos caracteres coinciden.
export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Vercel Cron siempre invoca por GET y sin sesión de usuario, así que esta
// ruta va montada antes de authMiddleware — se protege comprobando el
// propio secreto en vez de un JWT de Supabase. Vercel añade automáticamente
// `Authorization: Bearer $CRON_SECRET` a estas llamadas cuando esa variable
// de entorno existe en el proyecto (ver vercel.json → crons).
//
// Tareas diarias de mantenimiento — ambas idempotentes (ON CONFLICT DO
// NOTHING con una clave única de por medio), así que una entrega duplicada
// del cron —posible según la propia documentación de Vercel— no duplica
// nada:
//  1. Generar las ocurrencias pendientes de los recurrentes (antes vivía en
//     GET /transactions y GET /recurring-transactions — un GET no debería
//     escribir; crear/editar/activar una regla lo sigue haciendo al momento).
//  2. Evaluar las reglas de alerta configurables.
cronRouter.get("/daily", async (req, res, next) => {
  try {
    if (!env.CRON_SECRET) {
      return res.status(503).json({ error: "CRON_SECRET no configurado" });
    }
    if (!isAuthorized(req.headers.authorization, env.CRON_SECRET)) {
      return res.status(401).json({ error: "No autorizado" });
    }

    // Las dos tareas son independientes: si una falla del todo, la otra se
    // ejecuta igualmente (antes un error en recurrentes dejaba a todos los
    // usuarios sin evaluación de alertas).
    let recurring: Awaited<ReturnType<typeof syncAllUsersRecurringTransactions>> | null = null;
    let alerts: Awaited<ReturnType<typeof evaluateAllRules>> | null = null;
    const errors: string[] = [];

    try {
      recurring = await syncAllUsersRecurringTransactions();
      logger.info(recurring, "Sincronización diaria de recurrentes completada");
    } catch (err) {
      errors.push("recurring");
      logger.error({ err }, "Falló la sincronización diaria de recurrentes");
    }

    try {
      alerts = await evaluateAllRules();
      logger.info(alerts, "Evaluación diaria de alertas completada");
    } catch (err) {
      errors.push("alerts");
      logger.error({ err }, "Falló la evaluación diaria de alertas");
    }

    // El registro de actividad guarda 180 días.
    try {
      const pruned = await pruneActivity();
      if (pruned) logger.info({ pruned }, "Registro de actividad podado");
    } catch (err) {
      logger.warn({ err }, "No se pudo podar el registro de actividad");
    }

    const partial = errors.length > 0 || (recurring?.usersFailed ?? 0) > 0;
    // 500 si algo falló, para que el fallo se vea en el panel de Crons de Vercel.
    res.status(partial ? 500 : 200).json({ ok: !partial, recurring, alerts, errors });
  } catch (err) {
    next(err);
  }
});
