import { describe } from "vitest";
import { sql } from "drizzle-orm";

/** `describe` que solo corre con TEST_DATABASE_URL definida (ver test/setup.ts). */
export function describeDb(name: string, fn: () => void): void {
  (process.env.TEST_DATABASE_URL ? describe : describe.skip)(name, fn);
}

/** Vacía todas las tablas de `public` (reinicia los serial). Solo para la BBDD de pruebas. */
export async function resetDb(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) throw new Error("resetDb solo se usa con TEST_DATABASE_URL");
  const { db } = await import("../db/index.js");
  const rows = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const names = [...rows].map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

/** Crea un usuario con lo mínimo y devuelve su id. */
export async function createUser(tag: string): Promise<number> {
  const { db } = await import("../db/index.js");
  const { users } = await import("../db/schema.js");
  const [u] = await db.insert(users).values({ email: `${tag}@test.local`, name: tag, supabaseUserId: `sb-${tag}` }).returning();
  return u.id;
}
