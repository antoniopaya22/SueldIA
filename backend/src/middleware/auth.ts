import type { Request, Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/index.js";
import { profiles, users } from "../db/schema.js";
import { createDefaultAlertRules } from "../services/alerts.service.js";
import { findShare } from "../services/sharing.service.js";
import { logger } from "../logger.js";

export interface AuthPayload {
  userId: number;
  email: string;
}

// Augment Express Request so req.user is available after authMiddleware
declare global {
  namespace Express {
    interface Request {
      /** Dueño de los datos de la petición (con X-View-As, el titular que comparte). */
      user?: AuthPayload;
      /** Quien de verdad hace la petición, si está viendo los datos de otro. */
      viewer?: AuthPayload;
    }
  }
}

// Claves públicas de Supabase para verificar sus JWT sin llamar a su API en
// cada petición — requiere que el proyecto tenga firmado asimétrico activado
// (Settings → API → JWT Keys).
const JWKS = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

// Evita el SELECT/INSERT a `users` en cada petición autenticada — el par
// (id, email) de un supabase_user_id no cambia entre peticiones, así que
// basta con refrescarlo cada pocos minutos por si acaso.
const USER_CACHE_TTL_MS = 5 * 60_000;
const userCache = new Map<string, { user: AuthPayload; expires: number }>();

interface SupabasePayload {
  sub: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

/** Olvida el usuario cacheado (p. ej. tras eliminar su cuenta). */
export function forgetCachedUser(supabaseUserId: string): void {
  userCache.delete(supabaseUserId);
}

/**
 * Busca el usuario por su id de Supabase o lo crea la primera vez. Idempotente:
 * al cargar una página se lanzan varias peticiones a la vez y, para un usuario
 * nuevo, todas intentaban insertarlo — la segunda violaba la clave única y
 * acababa en 401, cerrando la sesión en el primer acceso.
 */
async function findOrCreateUser(payload: SupabasePayload & { email: string }): Promise<AuthPayload> {
  const [existing] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.supabaseUserId, payload.sub));
  if (existing) return { userId: existing.id, email: existing.email };

  const [inserted] = await db
    .insert(users)
    .values({
      supabaseUserId: payload.sub,
      email: payload.email,
      name: payload.user_metadata?.full_name ?? payload.user_metadata?.name ?? payload.email,
    })
    .onConflictDoNothing({ target: users.supabaseUserId })
    .returning({ id: users.id });
  // Solo quien de verdad ha creado la fila (no las peticiones simultáneas que
  // chocan con ella) siembra las reglas de alerta por defecto.
  if (inserted) {
    try {
      await createDefaultAlertRules(inserted.id);
      // Un perfil con el nombre de pila: así se puede subir la primera nómina
      // sin pasar antes por «Perfiles».
      const fullName = payload.user_metadata?.full_name ?? payload.user_metadata?.name ?? "";
      const firstName = fullName.trim().split(/\s+/)[0] || "Yo";
      await db.insert(profiles).values({ userId: inserted.id, name: firstName.slice(0, 100) });
    } catch (err) {
      logger.error({ err, userId: inserted.id }, "No se pudieron crear las alertas o el perfil por defecto");
    }
  }
  const [created] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.supabaseUserId, payload.sub));
  return { userId: created.id, email: created.email };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token requerido" });
  }

  // 1. Verificar el token: cualquier fallo aquí sí es un 401 (el frontend
  //    cierra la sesión y manda a /login).
  let payload: SupabasePayload;
  try {
    ({ payload } = await jwtVerify<SupabasePayload>(header.slice(7), JWKS, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      // Los JWT de Supabase Auth siempre llevan aud: "authenticated" — lo
      // comprobamos explícitamente para no aceptar tokens emitidos para
      // otro fin (p. ej. un token de servicio) que compartan emisor.
      audience: "authenticated",
    }));
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }

  if (!payload.sub || !payload.email) {
    return res.status(401).json({ error: "Token inválido" });
  }

  const cached = userCache.get(payload.sub);
  if (cached && cached.expires > Date.now()) {
    req.user = cached.user;
    return applyViewAs(req, res, next);
  }

  // 2. Resolver el usuario en la BBDD. Un fallo aquí NO es un problema del
  //    token: antes también acababa en 401 y una caída breve de la base de
  //    datos echaba a todo el mundo de su sesión. Ahora va al errorHandler (500).
  try {
    req.user = await findOrCreateUser({ ...payload, email: payload.email });
    userCache.set(payload.sub, { user: req.user, expires: Date.now() + USER_CACHE_TTL_MS });
  } catch (err) {
    return next(err);
  }
  return applyViewAs(req, res, next);
}

// Lo que siempre va con la identidad propia aunque se esté viendo a otro:
// la cuenta, gestionar lo compartido, los avisos del dispositivo, las
// preferencias de interfaz y los informes de errores.
const OWN_IDENTITY = new Set(["/api/auth", "/api/sharing", "/api/push", "/api/preferences", "/api/client-errors"]);

/**
 * «Ver como» (compartir en solo lectura): con la cabecera X-View-As = id del
 * titular, y si este ha compartido sus datos con quien llama, la petición se
 * atiende con los datos del titular (req.user) y quien llama queda en
 * req.viewer. Solo lectura: cualquier escritura, y las descargas, dan 403.
 * Como todas las rutas filtran por req.user, no hay que tocar ninguna.
 */
async function applyViewAs(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers["x-view-as"];
  if (raw === undefined || OWN_IDENTITY.has(req.baseUrl)) return next();
  const ownerId = Number(raw);
  if (!Number.isInteger(ownerId) || ownerId <= 0) return res.status(400).json({ error: "Cabecera X-View-As inválida" });
  if (ownerId === req.user!.userId) return next();
  try {
    const owner = await findShare(req.user!.userId, ownerId);
    if (!owner) return res.status(403).json({ error: "Ya no tienes acceso a esos datos", code: "view_as_revoked" });
    if ((req.method !== "GET" && req.method !== "HEAD") || req.baseUrl === "/api/export") {
      return res.status(403).json({ error: "Estás viendo los datos de otra persona: solo lectura", code: "read_only" });
    }
    req.viewer = req.user;
    req.user = { userId: ownerId, email: owner.email };
    next();
  } catch (err) {
    next(err);
  }
}
