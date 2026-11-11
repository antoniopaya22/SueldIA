import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { accounts, recurringSkips, recurringTransactions, transactions } from "../db/schema.js";
import { todayIso } from "../utils/dates.js";
import { logger } from "../logger.js";

export type RecurringCadence = "weekly" | "monthly" | "yearly";

export interface RecurringScheduleInput {
  startDate: string;
  endDate: string | null;
  cadence: RecurringCadence;
  intervalCount: number;
}

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [yearPart, monthPart, dayPart] = isoDate.split("-");
  return {
    year: Number(yearPart),
    month: Number(monthPart),
    day: Number(dayPart),
  };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDaysIso(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function addMonthsFromBase(isoDate: string, monthsToAdd: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const absoluteMonth = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = (absoluteMonth % 12) + 1;
  const targetDay = Math.min(day, getDaysInMonth(targetYear, targetMonth));
  return formatIsoDate(targetYear, targetMonth, targetDay);
}

function addYearsFromBase(isoDate: string, yearsToAdd: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const targetYear = year + yearsToAdd;
  const targetDay = Math.min(day, getDaysInMonth(targetYear, month));
  return formatIsoDate(targetYear, month, targetDay);
}

// Hoy en hora de Madrid (el servidor corre en UTC) — ver utils/dates.ts.
export function getTodayIsoDate(reference = new Date()): string {
  return todayIso(reference);
}

export function getOccurrenceDate(
  input: RecurringScheduleInput,
  occurrenceIndex: number,
): string {
  const effectiveStep = occurrenceIndex * input.intervalCount;

  switch (input.cadence) {
    case "weekly":
      return addDaysIso(input.startDate, effectiveStep * 7);
    case "yearly":
      return addYearsFromBase(input.startDate, effectiveStep);
    case "monthly":
    default:
      return addMonthsFromBase(input.startDate, effectiveStep);
  }
}

export function listOccurrenceDates(
  input: RecurringScheduleInput,
  throughDate: string,
): string[] {
  const dates: string[] = [];

  for (let occurrenceIndex = 0; occurrenceIndex < 1000; occurrenceIndex += 1) {
    const occurrenceDate = getOccurrenceDate(input, occurrenceIndex);
    if (occurrenceDate > throughDate) {
      break;
    }

    if (input.endDate && occurrenceDate > input.endDate) {
      break;
    }

    dates.push(occurrenceDate);
  }

  return dates;
}

export function getNextOccurrenceDate(
  input: RecurringScheduleInput,
  fromDate: string,
): string | null {
  for (let occurrenceIndex = 0; occurrenceIndex < 1000; occurrenceIndex += 1) {
    const occurrenceDate = getOccurrenceDate(input, occurrenceIndex);
    if (input.endDate && occurrenceDate > input.endDate) {
      return null;
    }

    if (occurrenceDate >= fromDate) {
      return occurrenceDate;
    }
  }

  return null;
}

export function getRecurringSyncThroughDate(lookaheadDays = 30): string {
  return addDaysIso(getTodayIsoDate(), lookaheadDays);
}

/** Una ocurrencia se liquida sola si su regla es una domiciliación y ya le ha llegado el día. */
export function shouldAutoSettle(rule: { autoSettle: boolean }, occurrenceDate: string, today: string): boolean {
  return rule.autoSettle && occurrenceDate <= today;
}

/** Pendientes por regla, separando las que ya vencieron (fecha de hoy o anterior) de las futuras. */
export function summarizePending(
  rows: { recurringTransactionId: number | null; date: string }[],
  today: string,
): Map<number, { pending: number; overdue: number }> {
  const out = new Map<number, { pending: number; overdue: number }>();
  for (const row of rows) {
    if (row.recurringTransactionId === null) continue;
    const entry = out.get(row.recurringTransactionId) ?? { pending: 0, overdue: 0 };
    entry.pending += 1;
    if (row.date <= today) entry.overdue += 1;
    out.set(row.recurringTransactionId, entry);
  }
  return out;
}

/** Claves «regla:fecha» de las ocurrencias saltadas de esas reglas. */
export async function skippedOccurrenceKeys(ruleIds: number[], dbOrTx: DbOrTx = db): Promise<Set<string>> {
  if (ruleIds.length === 0) return new Set();
  const rows = await dbOrTx
    .select({ ruleId: recurringSkips.recurringTransactionId, scheduledFor: recurringSkips.scheduledFor })
    .from(recurringSkips)
    .where(inArray(recurringSkips.recurringTransactionId, ruleIds));
  return new Set(rows.map((r) => buildOccurrenceKey(r.ruleId, r.scheduledFor)));
}

function buildOccurrenceKey(recurringTransactionId: number, scheduledFor: string): string {
  return `${recurringTransactionId}:${scheduledFor}`;
}

export async function syncRecurringTransactions(
  userId: number,
  throughDate = getRecurringSyncThroughDate(),
  dbOrTx: DbOrTx = db,
): Promise<number> {
  const rules = await dbOrTx
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.active, true),
        lte(recurringTransactions.startDate, throughDate),
      ),
    );

  if (rules.length === 0) {
    return 0;
  }

  const existingGeneratedTransactions = await dbOrTx
    .select({
      recurringTransactionId: transactions.recurringTransactionId,
      scheduledFor: transactions.scheduledFor,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNotNull(transactions.recurringTransactionId),
        isNotNull(transactions.scheduledFor),
        lte(transactions.scheduledFor, throughDate),
      ),
    );

  const existingKeys = new Set(
    existingGeneratedTransactions.flatMap((row) => (
      row.recurringTransactionId !== null && row.scheduledFor !== null
        ? [buildOccurrenceKey(row.recurringTransactionId, row.scheduledFor)]
        : []
    )),
  );
  // Las saltadas («esta vez no») cuentan como ya generadas: no vuelven a salir.
  for (const key of await skippedOccurrenceKeys(rules.map((r) => r.id), dbOrTx)) existingKeys.add(key);

  const rowsToInsert: Array<typeof transactions.$inferInsert> = [];
  const transfersToInsert: Array<{ out: typeof transactions.$inferInsert; targetAccountId: number }> = [];
  const today = getTodayIsoDate();
  const accountNames = new Map(
    (await dbOrTx.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId))).map((a) => [a.id, a.name]),
  );

  for (const rule of rules) {
    const occurrenceDates = listOccurrenceDates(
      {
        startDate: rule.startDate,
        endDate: rule.endDate,
        cadence: rule.cadence,
        intervalCount: rule.intervalCount,
      },
      throughDate,
    );

    for (const occurrenceDate of occurrenceDates) {
      const occurrenceKey = buildOccurrenceKey(rule.id, occurrenceDate);
      if (existingKeys.has(occurrenceKey)) {
        continue;
      }

      const row: typeof transactions.$inferInsert = {
        userId,
        accountId: rule.accountId,
        categoryId: rule.type === "transfer" ? null : rule.categoryId,
        type: rule.type,
        amount: rule.amount,
        date: occurrenceDate,
        recurringTransactionId: rule.id,
        scheduledFor: occurrenceDate,
        payee: rule.type === "transfer" ? rule.payee ?? `Traspaso a ${accountNames.get(rule.targetAccountId ?? 0) ?? "otra cuenta"}` : rule.payee,
        memo: rule.memo,
        cleared: shouldAutoSettle(rule, occurrenceDate, today),
        flag: rule.flag,
        importedFrom: "recurring",
      };
      if (rule.type === "transfer") {
        if (rule.targetAccountId) transfersToInsert.push({ out: row, targetAccountId: rule.targetAccountId });
      } else {
        rowsToInsert.push(row);
      }

      existingKeys.add(occurrenceKey);
    }
  }

  for (let index = 0; index < rowsToInsert.length; index += 100) {
    const batch = rowsToInsert.slice(index, index + 100);
    // onConflictDoNothing: red de seguridad además del chequeo en memoria de
    // arriba — si dos peticiones sincronizan a la vez, la clave única de
    // (recurring_transaction_id, scheduled_for) evita duplicar la fila
    // aunque ambas hayan decidido insertarla antes de que la otra terminase.
    await dbOrTx
      .insert(transactions)
      .values(batch)
      .onConflictDoNothing({ target: [transactions.recurringTransactionId, transactions.scheduledFor] });
  }

  // Traspasos: dos patas enlazadas, la de salida primero (la dirección de un
  // traspaso se deduce del orden de los ids: ver signedAmountSql). Solo la de
  // salida apunta a la regla (la clave única regla + fecha admite una fila).
  for (const { out, targetAccountId } of transfersToInsert) {
    const [outflow] = await dbOrTx
      .insert(transactions)
      .values(out)
      .onConflictDoNothing({ target: [transactions.recurringTransactionId, transactions.scheduledFor] })
      .returning({ id: transactions.id });
    if (!outflow) continue; // otra petición la creó a la vez
    const [inflow] = await dbOrTx
      .insert(transactions)
      .values({
        userId,
        accountId: targetAccountId,
        categoryId: null,
        type: "transfer",
        amount: out.amount,
        date: out.date,
        payee: `Transfer : ${accountNames.get(out.accountId) ?? ""}`,
        memo: out.memo,
        cleared: out.cleared,
        flag: out.flag,
        importedFrom: "recurring",
        transferId: outflow.id,
      })
      .returning({ id: transactions.id });
    await dbOrTx.update(transactions).set({ transferId: inflow.id }).where(eq(transactions.id, outflow.id));
  }

  await settleDueAutoOccurrences(userId, dbOrTx);

  return rowsToInsert.length + transfersToInsert.length;
}

/**
 * Liquida las ocurrencias pendientes ya vencidas de las reglas con liquidación
 * automática (también las que se generaron antes de activar esa opción). Se
 * ejecuta al final de cada sincronización, así que el cron diario la cubre.
 */
export async function settleDueAutoOccurrences(userId: number, dbOrTx: DbOrTx = db): Promise<void> {
  const autoRules = dbOrTx
    .select({ id: recurringTransactions.id })
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, userId),
        eq(recurringTransactions.active, true),
        eq(recurringTransactions.autoSettle, true),
      ),
    );
  const settled = await dbOrTx
    .update(transactions)
    .set({ cleared: true })
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.cleared, false),
        isNotNull(transactions.scheduledFor),
        lte(transactions.scheduledFor, getTodayIsoDate()),
        inArray(transactions.recurringTransactionId, autoRules),
      ),
    )
    .returning({ transferId: transactions.transferId });
  // La otra pata de un traspaso recurrente se liquida a la vez.
  const partners = settled.flatMap((r) => (r.transferId ? [r.transferId] : []));
  if (partners.length) {
    await dbOrTx.update(transactions).set({ cleared: true }).where(and(eq(transactions.userId, userId), inArray(transactions.id, partners)));
  }
}

export async function deletePendingRecurringOccurrences(
  userId: number,
  recurringTransactionId: number,
  dbOrTx: DbOrTx = db,
): Promise<void> {
  const deleted = await dbOrTx
    .delete(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTransactionId, recurringTransactionId),
        eq(transactions.cleared, false),
      ),
    )
    .returning({ transferId: transactions.transferId });
  // Y la pata de entrada de los traspasos (no apunta a la regla).
  const partners = deleted.flatMap((r) => (r.transferId ? [r.transferId] : []));
  if (partners.length) {
    await dbOrTx.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, partners)));
  }
}

export async function countPendingOccurrencesByRule(
  userId: number,
): Promise<Map<number, { pending: number; overdue: number }>> {
  const rows = await db
    .select({
      recurringTransactionId: transactions.recurringTransactionId,
      date: transactions.date,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNotNull(transactions.recurringTransactionId),
        eq(transactions.cleared, false),
      ),
    );

  return summarizePending(rows, getTodayIsoDate());
}

export async function getPendingOccurrencesForRule(
  userId: number,
  recurringTransactionId: number,
): Promise<number> {
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTransactionId, recurringTransactionId),
        eq(transactions.cleared, false),
      ),
    );

  return rows.length;
}

/**
 * Genera las ocurrencias pendientes de todos los usuarios con alguna regla
 * activa — pensado para el cron diario, ahora que GET /transactions y
 * GET /recurring-transactions ya no lo hacen en cada lectura (crear,
 * editar y activar/desactivar una regla lo siguen disparando al momento).
 */
export async function syncAllUsersRecurringTransactions(): Promise<{
  usersSynced: number;
  usersFailed: number;
  occurrencesCreated: number;
}> {
  const userIds = await db
    .selectDistinct({ userId: recurringTransactions.userId })
    .from(recurringTransactions)
    .where(eq(recurringTransactions.active, true));

  let occurrencesCreated = 0;
  let usersFailed = 0;
  for (const { userId } of userIds) {
    // Un usuario con datos rotos (p. ej. una regla antigua con fecha
    // imposible) no puede dejar sin sus recurrentes a todos los que vienen
    // detrás en el bucle — antes un solo error abortaba el cron entero.
    try {
      occurrencesCreated += await syncRecurringTransactions(userId);
    } catch (err) {
      usersFailed++;
      logger.error({ err, userId }, "Error sincronizando recurrentes de un usuario");
    }
  }
  return { usersSynced: userIds.length - usersFailed, usersFailed, occurrencesCreated };
}