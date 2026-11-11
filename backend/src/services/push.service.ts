import webpush from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/index.js";
import { pushSubscriptions } from "../db/schema.js";
import { logger } from "../logger.js";

// Notificaciones push de la PWA con Web Push estándar (VAPID): sin proveedor
// de pago, el navegador del usuario recibe el aviso a través del servicio de
// push de su fabricante, cifrado de extremo a extremo.
//
// El contenido es discreto a propósito: el nombre de la regla, nunca importes
// ni nombres (se ve en la pantalla de bloqueo). El detalle está en la app.

let configured = false;
export function pushEnabled(): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Guarda (o reasigna) la suscripción de este navegador. */
export async function saveSubscription(userId: number, sub: PushSubscriptionInput): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  // Como mucho las N más recientes: los navegadores renuevan el endpoint y las viejas se acumularían.
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(pushSubscriptions.createdAt);
  const extra = rows.slice(0, Math.max(0, rows.length - MAX_SUBSCRIPTIONS_PER_USER)).map((r) => r.id);
  if (extra.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
}

export async function removeSubscription(userId: number, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Un aviso con la misma etiqueta sustituye al anterior en vez de apilarse. */
  tag?: string;
}

/** Texto del aviso para las alertas nuevas de una evaluación (puro, probado). */
export function alertsPushMessage(ruleNames: string[]): PushMessage | null {
  if (ruleNames.length === 0) return null;
  const unique = [...new Set(ruleNames)];
  return {
    title: ruleNames.length === 1 ? "Nueva alerta en SueldIA" : `${ruleNames.length} alertas nuevas en SueldIA`,
    body: unique.length === 1 ? unique[0] : `${unique.slice(0, 2).join(", ")}${unique.length > 2 ? "…" : ""}`,
    url: "/app/alerts",
    tag: "sueldia-alerts",
  };
}

/**
 * Envía el aviso a todos los dispositivos del usuario. Nunca lanza: un fallo de
 * push no debe romper la evaluación de alertas. Las suscripciones caducadas
 * (404/410) se borran.
 */
export async function notifyUser(userId: number, message: PushMessage): Promise<number> {
  if (!pushEnabled()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  const expired: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(message),
          { TTL: 24 * 3600, urgency: "normal", timeout: 5000 },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(s.id);
        else logger.warn({ status }, "No se pudo enviar una notificación push");
      }
    }),
  );
  if (expired.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, expired));
  return sent;
}
