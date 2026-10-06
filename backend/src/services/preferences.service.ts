import { and, count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userPreferences } from "../db/schema.js";

export const MAX_PREFERENCE_BYTES = 32_000;
export const MAX_PREFERENCES_PER_USER = 100;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isValidPreferenceKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Serializa el valor y comprueba que cabe (puro, probado). Devuelve el JSON o el motivo del rechazo. */
export function serializePreference(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: false, error: "Falta el valor" };
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { ok: false, error: "El valor no se puede guardar" };
  }
  if (json === undefined) return { ok: false, error: "El valor no se puede guardar" };
  if (Buffer.byteLength(json, "utf8") > MAX_PREFERENCE_BYTES) {
    return { ok: false, error: `El valor es demasiado grande (máximo ${MAX_PREFERENCE_BYTES / 1000} KB)` };
  }
  return { ok: true, json };
}

/** Todas las preferencias del usuario como objeto; un valor corrupto se ignora en vez de romper la lista. */
export async function listPreferences(userId: number): Promise<Record<string, unknown>> {
  const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // Valor ilegible: se omite.
    }
  }
  return out;
}

export type SetPreferenceResult = { ok: true } | { ok: false; status: number; error: string };

export async function setPreference(userId: number, key: string, value: unknown): Promise<SetPreferenceResult> {
  if (!isValidPreferenceKey(key)) return { ok: false, status: 400, error: "Clave inválida" };
  const serialized = serializePreference(value);
  if (!serialized.ok) return { ok: false, status: 400, error: serialized.error };

  const [existing] = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)));
  if (!existing) {
    const [{ total }] = await db
      .select({ total: count() })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    if (total >= MAX_PREFERENCES_PER_USER) {
      return { ok: false, status: 409, error: "Has alcanzado el máximo de preferencias guardadas" };
    }
  }

  await db
    .insert(userPreferences)
    .values({ userId, key, value: serialized.json })
    .onConflictDoUpdate({
      target: [userPreferences.userId, userPreferences.key],
      set: { value: serialized.json, updatedAt: new Date() },
    });
  return { ok: true };
}

export async function deletePreference(userId: number, key: string): Promise<boolean> {
  const rows = await db
    .delete(userPreferences)
    .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
    .returning({ id: userPreferences.id });
  return rows.length > 0;
}
