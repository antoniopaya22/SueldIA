import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, type DbOrTx } from "../db/index.js";
import { recurringTransactions, transactions } from "../db/schema.js";

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

function addMonthsFromBase(isoDate: string, monthsToAdd: number): string {
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

export function getTodayIsoDate(reference = new Date()): string {
  return formatIsoDate(reference.getFullYear(), reference.getMonth() + 1, reference.getDate());
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

  const rowsToInsert: Array<typeof transactions.$inferInsert> = [];
  const today = getTodayIsoDate();

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

      rowsToInsert.push({
        userId,
        accountId: rule.accountId,
        categoryId: rule.categoryId,
        type: rule.type,
        amount: rule.amount,
        date: occurrenceDate,
        recurringTransactionId: rule.id,
        scheduledFor: occurrenceDate,
        payee: rule.payee,
        memo: rule.memo,
        cleared: shouldAutoSettle(rule, occurrenceDate, today),
        flag: rule.flag,
        importedFrom: "recurring",
      });

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

  await settleDueAutoOccurrences(userId, dbOrTx);

  return rowsToInsert.length;
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
  await dbOrTx
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
    );
}

export async function deletePendingRecurringOccurrences(
  userId: number,
  recurringTransactionId: number,
  dbOrTx: DbOrTx = db,
): Promise<void> {
  await dbOrTx
    .delete(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTransactionId, recurringTransactionId),
        eq(transactions.cleared, false),
      ),
    );
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
export async function syncAllUsersRecurringTransactions(): Promise<{ usersSynced: number; occurrencesCreated: number }> {
  const userIds = await db
    .selectDistinct({ userId: recurringTransactions.userId })
    .from(recurringTransactions)
    .where(eq(recurringTransactions.active, true));

  let occurrencesCreated = 0;
  for (const { userId } of userIds) {
    occurrencesCreated += await syncRecurringTransactions(userId);
  }
  return { usersSynced: userIds.length, occurrencesCreated };
}