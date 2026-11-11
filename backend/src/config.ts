import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:4321"),
  // En producción (Vercel) siempre se define explícitamente (Supabase). El
  // valor por defecto es solo para desarrollo local/tests contra un Postgres
  // local — el cliente de postgres-js es perezoso, no conecta hasta la
  // primera query, así que no rompe tests que no tocan la BBDD.
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/sueldia"),
  // URL del proyecto de Supabase (Project Settings → API → Project URL), NO
  // la connection string de la BBDD — se usa para verificar los JWT que
  // emite Supabase Auth contra su endpoint JWKS público. El valor por
  // defecto solo evita que tests/typecheck exijan configurarlo en local.
  SUPABASE_URL: z.string().default("https://localhost.supabase.co"),
  // Secreto compartido con Vercel Cron para autenticar la llamada diaria a
  // /api/cron/daily — sin configurar, esa ruta responde 503 (ver
  // routes/cron.ts). No hace falta en local/tests.
  CRON_SECRET: z.string().optional(),
  // Service role key de Supabase (Project Settings → API → service_role,
  // NUNCA la anon key) — solo se usa para borrar la identidad de Auth cuando
  // alguien elimina su cuenta (DELETE /api/auth/me). Sin ella, se borran
  // igualmente todos sus datos, pero la persona podría volver a entrar con
  // el mismo login de Google y empezar una cuenta nueva desde cero.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
