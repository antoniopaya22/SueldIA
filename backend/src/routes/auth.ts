import { Router } from "express";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authMiddleware, forgetCachedUser } from "../middleware/auth.js";
import { env } from "../config.js";
import { logger } from "../logger.js";

export const authRouter = Router();

// El login/registro lo gestiona Supabase Auth (Google) directamente desde el
// frontend — authMiddleware ya crea la fila en `users` la primera vez que
// llega un token válido, así que aquí solo queda leer/actualizar el perfil.

// Get current user
authRouter.get("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, req.user.userId));

    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100),
});

// Update user profile (name)
authRouter.put("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });

    const [updated] = await db
      .update(users)
      .set({ name: parsed.data.name })
      .where(eq(users.id, req.user.userId))
      .returning({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt });

    if (!updated) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Eliminar cuenta (derecho de supresión RGPD): borra el usuario y, en
// cascada (onDelete: "cascade" en cada tabla que cuelga de users.id, ver
// schema.ts), perfiles, nóminas, conceptos, notas, etiquetas, cuentas,
// categorías, transacciones, recurrentes y reglas/historial de alertas.
authRouter.delete("/me", authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    const { userId } = req.user;

    const [row] = await db
      .select({ supabaseUserId: users.supabaseUserId })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) return res.status(404).json({ error: "Usuario no encontrado" });

    // 1. Primero los datos: es lo que la persona pide borrar y lo único que
    //    controlamos de forma transaccional. Antes se borraba primero la
    //    identidad de Supabase y, si después fallaba este paso, los datos
    //    quedaban huérfanos e inaccesibles.
    await db.delete(users).where(eq(users.id, userId));
    // Sin esto, durante unos minutos un token aún vigente seguía pasando el
    // middleware con un userId que ya no existe (o recreaba la cuenta).
    forgetCachedUser(row.supabaseUserId);

    // 2. Después la identidad en Supabase Auth, para que no pueda volver a
    //    entrar con el mismo login de Google y empezar una cuenta vacía.
    let identityDeleted = false;
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${row.supabaseUserId}`, {
          method: "DELETE",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        });
        identityDeleted = resp.ok;
        if (!resp.ok) logger.error({ userId, status: resp.status }, "No se pudo borrar la identidad en Supabase Auth");
      } catch (err) {
        logger.error({ userId, err }, "Error llamando a la Admin API de Supabase Auth");
      }
    } else {
      logger.warn(
        { userId },
        "SUPABASE_SERVICE_ROLE_KEY no configurado: se borran los datos pero la identidad de Supabase Auth sigue activa",
      );
    }

    // Los datos ya no existen en ningún caso; `identityDeleted` dice si
    // además se cerró el acceso, para que la interfaz lo cuente sin mentir.
    res.json({ ok: true, identityDeleted });
  } catch (err) {
    next(err);
  }
});
