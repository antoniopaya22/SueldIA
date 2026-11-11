import { eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import { AppError } from "../middleware/error-handler.js";

// Topes por usuario: muy por encima de cualquier uso real, pero evitan que un
// cliente (o un bucle con un error) llene la base de datos o haga lentas las
// evaluaciones del cron, que recorren estas tablas para cada usuario.
export const USER_LIMITS = {
  profiles: 20,
  accounts: 100,
  categoryGroups: 100,
  categories: 500,
  categoryRules: 1000,
  tags: 200,
  alertRules: 50,
  recurring: 300,
  notesPerPayslip: 100,
  savingsGoals: 50,
} as const;

/** Lanza 409 si ya hay `max` filas con `column = ownerId`. */
export async function assertUnderLimit(
  table: PgTable,
  column: PgColumn,
  ownerId: number,
  max: number,
  label: string,
): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(column, ownerId));
  if (n >= max) throw new AppError(409, `Has llegado al máximo de ${max} ${label}`);
}
