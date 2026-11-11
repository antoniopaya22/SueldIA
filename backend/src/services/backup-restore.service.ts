import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import * as s from "../db/schema.js";
import { AppError } from "../middleware/error-handler.js";
import { isoDateSchema, monthKeySchema } from "../utils/dates.js";
import { USER_LIMITS } from "../utils/limits.js";
import { moneySchema } from "../utils/validation.js";

// Restaurar una copia hecha con «Exportar todos mis datos» (GET /export/all).
// Sustituye TODO lo que hay en la cuenta por lo del fichero, dentro de una
// transacción: si algo falla, la cuenta queda como estaba. Los ids del
// fichero no se reutilizan (podrían chocar con los de otros usuarios): se
// reservan ids nuevos y se traducen todas las referencias entre tablas.

export const BACKUP_FORMAT = "sueldia-backup";
export const BACKUP_VERSION = 1;

/** Tope del JSON ya descomprimido (el fichero subido va comprimido y cabe en 4 MB). */
const MAX_JSON_BYTES = 64 * 1024 * 1024;

const id = z.number().int().positive().max(2_147_483_647);
const text = (max: number) => z.string().max(max);
const optText = (max: number) => z.string().max(max).nullable().optional();
const createdAt = z.coerce.date().optional();
const optMoney = moneySchema.nullable().optional();

const profileRow = z.object({ id, name: text(100).min(1), color: text(32), createdAt });
const payslipRow = z.object({
  id,
  profileId: id,
  fileName: text(255),
  periodMonth: z.number().int().min(1).max(12).nullable(),
  periodYear: z.number().int().min(1900).max(2200).nullable(),
  company: optText(255),
  grossSalary: optMoney,
  netSalary: optMoney,
  rawText: optText(1_000_000),
  parsingStatus: z.enum(["pending", "parsed", "error", "review"]),
  payslipType: z.enum(["ordinal", "extra"]),
  manuallyEdited: z.boolean().optional(),
  contentHash: optText(128),
  parserFormat: optText(64),
  parseMs: z.number().int().min(0).max(600_000).nullable().optional(),
  createdAt,
});
const conceptRow = z.object({
  payslipId: id,
  category: z.enum(["devengo", "deduccion", "otros"]),
  name: text(255),
  amount: moneySchema,
  isPercentage: z.boolean().optional(),
  kind: optText(64),
});
const noteRow = z.object({ payslipId: id, content: text(10_000), createdAt });
const tagRow = z.object({ id, name: text(100), color: text(32) });
const payslipTagRow = z.object({ payslipId: id, tagId: id });
const alertRuleRow = z.object({
  id,
  name: text(200),
  type: z.enum(s.alertRules.type.enumValues),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean(),
  createdAt,
});
const alertHistoryRow = z.object({
  ruleId: id.nullable(),
  payslipId: id.nullable(),
  type: text(64),
  severity: z.enum(["info", "warning", "critical"]),
  message: text(2000),
  read: z.boolean(),
  dedupeKey: optText(200),
  createdAt,
});
const accountRow = z.object({
  id,
  name: text(100).min(1),
  type: z.enum(s.accounts.type.enumValues),
  currency: text(8).optional(),
  initialBalance: moneySchema,
  color: text(32),
  icon: optText(64),
  archived: z.boolean(),
  sortOrder: z.number().int().optional(),
  lastReconciledAt: z.coerce.date().nullable().optional(),
  lastReconciledBalance: optMoney,
  createdAt,
});
const groupRow = z.object({ id, name: text(100), icon: optText(64), sortOrder: z.number().int(), createdAt });
const categoryRow = z.object({ id, groupId: id, name: text(100), sortOrder: z.number().int(), createdAt });
const transactionRow = z.object({
  id,
  accountId: id,
  categoryId: id.nullable(),
  type: z.enum(["expense", "income", "transfer"]),
  amount: moneySchema,
  date: isoDateSchema,
  recurringTransactionId: id.nullable().optional(),
  payslipId: id.nullable().optional(),
  scheduledFor: isoDateSchema.nullable().optional(),
  payee: optText(500),
  memo: optText(2000),
  cleared: z.boolean(),
  reconciled: z.boolean().optional(),
  transferId: id.nullable().optional(),
  flag: optText(32),
  importedFrom: optText(64),
  importBatchId: optText(64),
  splitGroupId: optText(64),
  createdAt,
});
const recurringRow = z.object({
  id,
  accountId: id,
  categoryId: id.nullable(),
  type: z.enum(["expense", "income"]),
  amount: moneySchema,
  cadence: z.enum(["weekly", "monthly", "yearly"]),
  intervalCount: z.number().int().min(1).max(365),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().optional(),
  payee: optText(500),
  memo: optText(2000),
  flag: optText(32),
  active: z.boolean(),
  autoSettle: z.boolean().optional(),
  createdAt,
});
const budgetRow = z.object({ categoryId: id, month: monthKeySchema, assigned: moneySchema, createdAt });
const targetRow = z.object({
  categoryId: id,
  type: z.enum(["monthly", "by_date"]),
  amount: moneySchema,
  targetMonth: monthKeySchema.nullable().optional(),
  createdAt,
});
const categoryRuleRow = z.object({
  match: text(200),
  categoryId: id,
  matchField: z.enum(["payee", "memo", "any"]).optional(),
  transactionType: z.enum(["expense", "income"]).nullable().optional(),
  minAmount: optMoney,
  maxAmount: optMoney,
  accountId: id.nullable().optional(),
  createdAt,
});
const preferenceRow = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), value: z.unknown() });

const list = <T extends z.ZodTypeAny>(row: T, max: number) => z.array(row).max(max).default([]);

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT).optional(),
  version: z.number().int().max(BACKUP_VERSION, "La copia es de una versión más nueva de SueldIA").optional(),
  exportedAt: z.string().optional(),
  profiles: list(profileRow, USER_LIMITS.profiles),
  payslips: list(payslipRow, 5_000),
  payslipConcepts: list(conceptRow, 200_000),
  payslipNotes: list(noteRow, 50_000),
  payslipTags: list(payslipTagRow, 50_000),
  tags: list(tagRow, USER_LIMITS.tags),
  accounts: list(accountRow, USER_LIMITS.accounts),
  categoryGroups: list(groupRow, USER_LIMITS.categoryGroups),
  categories: list(categoryRow, USER_LIMITS.categories),
  transactions: list(transactionRow, 200_000),
  recurringTransactions: list(recurringRow, USER_LIMITS.recurring),
  alertRules: list(alertRuleRow, USER_LIMITS.alertRules),
  alertHistory: list(alertHistoryRow, 50_000),
  budgets: list(budgetRow, 100_000),
  categoryTargets: list(targetRow, USER_LIMITS.categories),
  categoryRules: list(categoryRuleRow, USER_LIMITS.categoryRules),
  userPreferences: list(preferenceRow, 100),
});

export type Backup = z.infer<typeof backupSchema>;

/** Lo que se cuenta en la vista previa (lo que trae el fichero y lo que hay ahora). */
export interface BackupCounts {
  profiles: number;
  payslips: number;
  accounts: number;
  categories: number;
  transactions: number;
  recurringTransactions: number;
  budgets: number;
  categoryRules: number;
  alertRules: number;
}

/** Lee el fichero subido: JSON o JSON comprimido con gzip (lo que manda la app). */
export function readBackupFile(buffer: Buffer): Backup {
  let raw = buffer;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      raw = gunzipSync(buffer, { maxOutputLength: MAX_JSON_BYTES });
    } catch {
      throw new AppError(400, "El fichero está dañado o es demasiado grande");
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new AppError(400, "El fichero no es una copia de SueldIA (no es JSON válido)");
  }
  if (!json || typeof json !== "object" || !Array.isArray((json as Record<string, unknown>).profiles)) {
    throw new AppError(400, "El fichero no es una copia de SueldIA (usa «Exportar todos mis datos»)");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(400, `La copia no es válida (${issue.path.join(".")}: ${issue.message})`);
  }
  checkReferences(parsed.data);
  return parsed.data;
}

/**
 * Toda referencia obligatoria apunta a algo que está en el fichero (una copia
 * editada a mano o incompleta se rechaza antes de borrar nada). Las opcionales
 * que no se encuentran se quedan vacías al restaurar.
 */
function checkReferences(b: Backup): void {
  const ids = (rows: Array<{ id: number }>) => new Set(rows.map((r) => r.id));
  const profiles = ids(b.profiles);
  const payslips = ids(b.payslips);
  const tags = ids(b.tags);
  const accounts = ids(b.accounts);
  const groups = ids(b.categoryGroups);
  const categories = ids(b.categories);
  const transactions = new Map(b.transactions.map((t) => [t.id, t]));
  const fail = (what: string) => {
    throw new AppError(400, `La copia está incompleta o dañada: ${what}`);
  };
  if (b.payslips.some((p) => !profiles.has(p.profileId))) fail("una nómina sin su perfil");
  if (b.payslipConcepts.some((c) => !payslips.has(c.payslipId))) fail("conceptos sin su nómina");
  if (b.payslipNotes.some((n) => !payslips.has(n.payslipId))) fail("notas sin su nómina");
  if (b.payslipTags.some((t) => !payslips.has(t.payslipId) || !tags.has(t.tagId))) fail("etiquetas de nómina sueltas");
  if (b.categories.some((c) => !groups.has(c.groupId))) fail("una categoría sin su grupo");
  if (b.transactions.some((t) => !accounts.has(t.accountId))) fail("movimientos sin su cuenta");
  if (b.recurringTransactions.some((r) => !accounts.has(r.accountId))) fail("recurrentes sin su cuenta");
  if ([...b.budgets, ...b.categoryTargets, ...b.categoryRules].some((r) => !categories.has(r.categoryId))) {
    fail("presupuestos o reglas sin su categoría");
  }
  for (const t of b.transactions) {
    if (t.transferId == null) continue;
    const other = transactions.get(t.transferId);
    if (!other || other.transferId !== t.id) fail("un traspaso sin su otra mitad");
  }
  if (new Set(b.userPreferences.map((p) => p.key)).size !== b.userPreferences.length) fail("preferencias repetidas");
}

export function countBackup(b: Backup): BackupCounts {
  return {
    profiles: b.profiles.length,
    payslips: b.payslips.length,
    accounts: b.accounts.length,
    categories: b.categories.length,
    transactions: b.transactions.length,
    recurringTransactions: b.recurringTransactions.length,
    budgets: b.budgets.length,
    categoryRules: b.categoryRules.length,
    alertRules: b.alertRules.length,
  };
}

/** Lo que hay ahora en la cuenta (para avisar de lo que se va a sustituir). */
export async function countCurrent(userId: number): Promise<BackupCounts> {
  const count = (table: PgTable, where: SQL | undefined) =>
    db.select({ n: sql<number>`count(*)::int` }).from(table).where(where).then((r) => r[0]?.n ?? 0);
  const userProfiles = db.select({ id: s.profiles.id }).from(s.profiles).where(eq(s.profiles.userId, userId));
  const userGroups = db.select({ id: s.categoryGroups.id }).from(s.categoryGroups).where(eq(s.categoryGroups.userId, userId));
  const [profiles, payslips, accounts, categories, transactions, recurringTransactions, budgets, categoryRules, alertRules] =
    await Promise.all([
      count(s.profiles, eq(s.profiles.userId, userId)),
      count(s.payslips, inArray(s.payslips.profileId, userProfiles)),
      count(s.accounts, eq(s.accounts.userId, userId)),
      count(s.categories, inArray(s.categories.groupId, userGroups)),
      count(s.transactions, eq(s.transactions.userId, userId)),
      count(s.recurringTransactions, eq(s.recurringTransactions.userId, userId)),
      count(s.budgets, eq(s.budgets.userId, userId)),
      count(s.categoryRules, eq(s.categoryRules.userId, userId)),
      count(s.alertRules, eq(s.alertRules.userId, userId)),
    ]);
  return { profiles, payslips, accounts, categories, transactions, recurringTransactions, budgets, categoryRules, alertRules };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reserva `n` ids de la secuencia de la tabla: así se sabe el id nuevo de cada fila antes de insertarla. */
async function allocateIds(tx: Tx, table: string, n: number): Promise<number[]> {
  if (n === 0) return [];
  const rows = await tx.execute<{ id: number }>(
    sql`SELECT nextval(pg_get_serial_sequence(${table}, 'id'))::int AS id FROM generate_series(1, ${n})`,
  );
  return [...rows].map((r) => r.id);
}

const CHUNK = 500;
async function insertChunked(tx: Tx, table: PgTable, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tx.insert(table).values(rows.slice(i, i + CHUNK) as any);
  }
}

/** Mapa id antiguo → id nuevo, reservando los ids. */
async function remap(tx: Tx, table: string, rows: Array<{ id: number }>): Promise<Map<number, number>> {
  const fresh = await allocateIds(tx, table, rows.length);
  return new Map(rows.map((r, i) => [r.id, fresh[i]]));
}

const pick = (map: Map<number, number>, oldId: number | null | undefined) => (oldId == null ? null : map.get(oldId) ?? null);
const must = (map: Map<number, number>, oldId: number) => map.get(oldId)!;

/**
 * Las claves de deduplicación de alertas llevan ids (`salary_drop:<regla>:<nómina>`,
 * `low_balance:<regla>:<cuenta>:<mes>`…). Si no se traducen, el cron volvería a
 * emitir alertas que ya están en el historial.
 */
export function remapDedupeKey(
  key: string | null | undefined,
  maps: { rules: Map<number, number>; payslips: Map<number, number>; profiles: Map<number, number>; categories: Map<number, number>; accounts: Map<number, number> },
): string | null {
  if (!key) return null;
  const parts = key.split(":");
  const swap = (i: number, map: Map<number, number>) => {
    const n = Number(parts[i]);
    if (Number.isInteger(n) && map.has(n)) parts[i] = String(map.get(n));
  };
  switch (parts[0]) {
    case "missing": swap(1, maps.profiles); break;
    case "salary_drop": case "concept_change": case "custom_threshold": case "irpf_change":
      swap(1, maps.rules); swap(2, maps.payslips); break;
    case "overspent": case "budget_near": case "unusual": swap(1, maps.rules); swap(2, maps.categories); break;
    case "low_forecast": case "price_up": case "duplicate": swap(1, maps.rules); break;
    case "low_balance": swap(1, maps.rules); swap(2, maps.accounts); break;
    case "overdue": swap(1, maps.rules); break;
  }
  return parts.join(":");
}

/** Ids dentro de la configuración de una regla de alerta (perfil, categoría, cuenta). */
function remapAlertConfig(
  config: Record<string, unknown>,
  maps: { profiles: Map<number, number>; categories: Map<number, number>; accounts: Map<number, number> },
): Record<string, unknown> {
  const out = { ...config };
  for (const [key, map] of [["profileId", maps.profiles], ["categoryId", maps.categories], ["accountId", maps.accounts]] as const) {
    if (typeof out[key] === "number") {
      const next = map.get(out[key] as number);
      if (next) out[key] = next;
      else delete out[key];
    }
  }
  return out;
}

/** Borra los datos de la cuenta (no la identidad) y carga los de la copia. */
export async function restoreBackup(userId: number, b: Backup): Promise<BackupCounts> {
  try {
    await db.transaction(async (tx) => {
      // Todo lo demás cuelga de estas tablas y se va en cascada.
      for (const table of [s.transactions, s.recurringTransactions, s.budgets, s.categoryTargets, s.categoryRules,
        s.alertHistory, s.alertRules, s.accounts, s.categoryGroups, s.tags, s.profiles, s.userPreferences]) {
        await tx.delete(table).where(eq((table as typeof s.profiles).userId, userId));
      }

      const profiles = await remap(tx, "profiles", b.profiles);
      const payslips = await remap(tx, "payslips", b.payslips);
      const tags = await remap(tx, "tags", b.tags);
      const accounts = await remap(tx, "accounts", b.accounts);
      const groups = await remap(tx, "category_groups", b.categoryGroups);
      const categories = await remap(tx, "categories", b.categories);
      const recurring = await remap(tx, "recurring_transactions", b.recurringTransactions);
      const transactions = await remap(tx, "transactions", b.transactions);
      const rules = await remap(tx, "alert_rules", b.alertRules);

      await insertChunked(tx, s.profiles, b.profiles.map((p) => ({ ...p, id: must(profiles, p.id), userId })));
      await insertChunked(tx, s.payslips, b.payslips.map((p) => ({ ...p, id: must(payslips, p.id), profileId: must(profiles, p.profileId) })));
      await insertChunked(tx, s.payslipConcepts, b.payslipConcepts.map((c) => ({ ...c, payslipId: must(payslips, c.payslipId) })));
      await insertChunked(tx, s.payslipNotes, b.payslipNotes.map((n) => ({ ...n, payslipId: must(payslips, n.payslipId) })));
      await insertChunked(tx, s.tags, b.tags.map((t) => ({ ...t, id: must(tags, t.id), userId })));
      await insertChunked(tx, s.payslipTags, b.payslipTags.map((t) => ({ payslipId: must(payslips, t.payslipId), tagId: must(tags, t.tagId) })));
      await insertChunked(tx, s.accounts, b.accounts.map((a) => ({ ...a, id: must(accounts, a.id), userId })));
      await insertChunked(tx, s.categoryGroups, b.categoryGroups.map((g) => ({ ...g, id: must(groups, g.id), userId })));
      await insertChunked(tx, s.categories, b.categories.map((c) => ({ ...c, id: must(categories, c.id), groupId: must(groups, c.groupId) })));
      await insertChunked(tx, s.recurringTransactions, b.recurringTransactions.map((r) => ({
        ...r, id: must(recurring, r.id), userId, accountId: must(accounts, r.accountId), categoryId: pick(categories, r.categoryId),
      })));
      await insertChunked(tx, s.transactions, b.transactions.map((t) => ({
        ...t,
        id: must(transactions, t.id),
        userId,
        accountId: must(accounts, t.accountId),
        categoryId: pick(categories, t.categoryId),
        recurringTransactionId: pick(recurring, t.recurringTransactionId),
        payslipId: pick(payslips, t.payslipId),
        transferId: pick(transactions, t.transferId),
      })));
      await insertChunked(tx, s.alertRules, b.alertRules.map((r) => ({
        ...r, id: must(rules, r.id), userId, config: JSON.stringify(remapAlertConfig(r.config, { profiles, categories, accounts })),
      })));
      const keyMaps = { rules, payslips, profiles, categories, accounts };
      await insertChunked(tx, s.alertHistory, b.alertHistory.map((h) => ({
        ...h, userId, ruleId: pick(rules, h.ruleId), payslipId: pick(payslips, h.payslipId), dedupeKey: remapDedupeKey(h.dedupeKey, keyMaps),
      })));
      await insertChunked(tx, s.budgets, b.budgets.map((x) => ({ ...x, userId, categoryId: must(categories, x.categoryId) })));
      await insertChunked(tx, s.categoryTargets, b.categoryTargets.map((x) => ({ ...x, userId, categoryId: must(categories, x.categoryId) })));
      await insertChunked(tx, s.categoryRules, b.categoryRules.map((x) => ({
        ...x, userId, categoryId: must(categories, x.categoryId), accountId: pick(accounts, x.accountId),
      })));
      await insertChunked(tx, s.userPreferences, b.userPreferences.map((p) => ({ userId, key: p.key, value: JSON.stringify(p.value) ?? "null" })));
    });
  } catch (err) {
    // Duplicados o referencias imposibles en un fichero manipulado: la
    // transacción ya se ha deshecho, la cuenta sigue como estaba.
    const code = (err as { code?: string } | null)?.code ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === "23505" || code === "23503" || code === "23514") {
      throw new AppError(400, "La copia tiene datos repetidos o incoherentes; no se ha cambiado nada");
    }
    throw err;
  }
  return countBackup(b);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Todos los datos del usuario (derecho de portabilidad RGPD y copia de
 * seguridad): lo que hay en cada tabla que cuelga de su cuenta, sin filtrar ni
 * resumir. Es lo que lee `readBackupFile`. `null` si el usuario no existe.
 */
export async function buildFullExport(userId: number) {
  const [user] = await db
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, createdAt: s.users.createdAt })
    .from(s.users)
    .where(eq(s.users.id, userId));
  if (!user) return null;

  const userProfiles = await db.select().from(s.profiles).where(eq(s.profiles.userId, userId));
  const profileIds = userProfiles.map((p) => p.id);
  const userPayslips = profileIds.length ? await db.select().from(s.payslips).where(inArray(s.payslips.profileId, profileIds)) : [];
  const payslipIds = userPayslips.map((p) => p.id);
  const none = payslipIds.length === 0;

  const [concepts, notes, payslipTagLinks, tags, accounts, groups, categories, transactions, recurring, rules, history, budgets, targets, catRules, prefs] =
    await Promise.all([
      none ? [] : db.select().from(s.payslipConcepts).where(inArray(s.payslipConcepts.payslipId, payslipIds)),
      none ? [] : db.select().from(s.payslipNotes).where(inArray(s.payslipNotes.payslipId, payslipIds)),
      none ? [] : db.select().from(s.payslipTags).where(inArray(s.payslipTags.payslipId, payslipIds)),
      db.select().from(s.tags).where(eq(s.tags.userId, userId)),
      db.select().from(s.accounts).where(eq(s.accounts.userId, userId)),
      db.select().from(s.categoryGroups).where(eq(s.categoryGroups.userId, userId)),
      db
        .select({ category: s.categories })
        .from(s.categories)
        .innerJoin(s.categoryGroups, eq(s.categories.groupId, s.categoryGroups.id))
        .where(eq(s.categoryGroups.userId, userId))
        .then((rows) => rows.map((r) => r.category)),
      db.select().from(s.transactions).where(eq(s.transactions.userId, userId)),
      db.select().from(s.recurringTransactions).where(eq(s.recurringTransactions.userId, userId)),
      db.select().from(s.alertRules).where(eq(s.alertRules.userId, userId)),
      db.select().from(s.alertHistory).where(eq(s.alertHistory.userId, userId)),
      db.select().from(s.budgets).where(eq(s.budgets.userId, userId)),
      db.select().from(s.categoryTargets).where(eq(s.categoryTargets.userId, userId)),
      db.select().from(s.categoryRules).where(eq(s.categoryRules.userId, userId)),
      db.select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)),
    ]);

  return {
    // Para poder restaurarla (Ajustes → Restaurar una copia).
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    user,
    profiles: userProfiles,
    payslips: userPayslips,
    payslipConcepts: concepts,
    payslipNotes: notes,
    payslipTags: payslipTagLinks,
    tags,
    accounts,
    categoryGroups: groups,
    categories,
    transactions,
    recurringTransactions: recurring,
    alertRules: rules.map((r) => ({ ...r, config: safeJson(r.config) })),
    alertHistory: history,
    budgets,
    categoryTargets: targets,
    categoryRules: catRules,
    userPreferences: prefs.map((p) => ({ ...p, value: safeJson(p.value) })),
  };
}
