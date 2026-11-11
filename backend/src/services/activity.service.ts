import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { activityLog } from "../db/schema.js";
import { logger } from "../logger.js";
import { formatEur } from "../utils/format.js";

/* ───────── Registro de actividad ────────────────────────────────
 * «Qué ha cambiado y cuándo». Un middleware mira cada petición que modifica
 * datos y, si salió bien y la ruta está en ACTIVITY, apunta una línea en
 * español. Así no hay que acordarse de registrar en cada ruta, y lo que no
 * está en la lista (preferencias, avisos leídos, vistas previas) no ensucia.
 * Nunca rompe la petición: si falla el apunte, solo se registra en el log.
 */

interface Ctx {
  params: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  /** Lo que respondió la ruta (si fue JSON). */
  result: Record<string, unknown> | unknown[] | null;
}

type Describe = (c: Ctx) => { entity: string; summary: string; entityId?: number | null } | null;

const eur = (n: unknown) => (typeof n === "number" ? formatEur(n) : "");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const field = (o: Ctx["result"] | Ctx["body"], k: string): unknown => (o && !Array.isArray(o) ? (o as Record<string, unknown>)[k] : undefined);
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const named = (base: string, name: unknown) => (str(name) ? `${base}: ${str(name)}` : base);
const idParam = (c: Ctx) => (c.params.id ? Number(c.params.id) : null);

const TX_BATCH: Record<string, string> = {
  "set-category": "categorizados",
  "set-cleared": "cambiados de estado",
  delete: "eliminados",
  "set-flag": "marcados",
};
const PAYSLIP_BATCH: Record<string, string> = {
  delete: "eliminadas",
  "set-type": "cambiadas de tipo",
  "add-tag": "etiquetadas",
  "remove-tag": "sin una etiqueta",
};

/** Clave: "MÉTODO /api/base/ruta" tal como la declara Express. */
export const ACTIVITY: Record<string, Describe> = {
  // Movimientos
  "POST /api/transactions/": (c) => ({
    entity: "transaction",
    entityId: Number(field(c.result, "id")) || null,
    summary: `${c.body.type === "income" ? "Nuevo ingreso" : c.body.type === "transfer" ? "Nuevo traspaso" : "Nuevo gasto"}${str(c.body.payee) ? `: ${str(c.body.payee)}` : ""} (${eur(c.body.amount)})`,
  }),
  "PUT /api/transactions/:id": (c) => ({ entity: "transaction", entityId: idParam(c), summary: named("Movimiento editado", field(c.result, "payee")) }),
  "DELETE /api/transactions/:id": (c) => ({ entity: "transaction", entityId: idParam(c), summary: "Movimiento eliminado" }),
  "PATCH /api/transactions/:id/clear": (c) => ({ entity: "transaction", entityId: idParam(c), summary: c.body.cleared ? "Movimiento liquidado" : "Movimiento marcado como pendiente" }),
  "POST /api/transactions/:id/split": (c) => ({ entity: "transaction", entityId: idParam(c), summary: `Movimiento dividido en ${count(c.body.parts)} partes` }),
  "POST /api/transactions/:id/unsplit": (c) => ({ entity: "transaction", entityId: idParam(c), summary: "División de un movimiento deshecha" }),
  "POST /api/transactions/batch": (c) => {
    const n = Number(field(c.result, "updated")) || 0;
    return n ? { entity: "transaction", summary: `${plural(n, "movimiento", "movimientos")} ${TX_BATCH[String(c.body.action)] ?? "cambiados"} en lote` } : null;
  },
  "POST /api/transactions/payees/rename": (c) => {
    // Sin cambios (nada con ese nombre) no se apunta: sería solo el texto que se envió.
    if (!Number(field(c.result, "updated"))) return null;
    const from = Array.isArray(c.body.from) ? c.body.from.filter((x): x is string => typeof x === "string") : [];
    return { entity: "transaction", summary: `${from.length > 1 ? "Beneficiarios unificados" : "Beneficiario renombrado"}: ${from.slice(0, 3).map((f) => `«${f}»`).join(", ")}${from.length > 3 ? "…" : ""} → «${str(c.body.to) ?? ""}»` };
  },
  // Recurrentes
  "POST /api/recurring-transactions/": (c) => ({ entity: "recurring", entityId: Number(field(c.result, "id")) || null, summary: named("Nueva recurrente", c.body.payee) }),
  "PUT /api/recurring-transactions/:id": (c) => ({ entity: "recurring", entityId: idParam(c), summary: named("Recurrente editada", c.body.payee) }),
  "DELETE /api/recurring-transactions/:id": (c) => ({ entity: "recurring", entityId: idParam(c), summary: "Recurrente eliminada" }),
  "PATCH /api/recurring-transactions/:id/active": (c) => ({ entity: "recurring", entityId: idParam(c), summary: c.body.active ? "Recurrente reactivada" : "Recurrente pausada" }),
  "POST /api/recurring-transactions/skip-occurrence": () => ({ entity: "recurring", summary: "Saltada una vez una recurrente" }),
  // Cuentas
  "POST /api/accounts/": (c) => ({ entity: "account", entityId: Number(field(c.result, "id")) || null, summary: named("Cuenta creada", c.body.name) }),
  "PUT /api/accounts/:id": (c) => ({ entity: "account", entityId: idParam(c), summary: named("Cuenta editada", c.body.name) }),
  "DELETE /api/accounts/:id": (c) => ({ entity: "account", entityId: idParam(c), summary: "Cuenta eliminada con sus movimientos" }),
  "PATCH /api/accounts/:id/archive": (c) => ({ entity: "account", entityId: idParam(c), summary: named(field(c.result, "archived") ? "Cuenta archivada" : "Cuenta restaurada", field(c.result, "name")) }),
  "PUT /api/accounts/order": () => ({ entity: "account", summary: "Cuentas reordenadas" }),
  "POST /api/accounts/:id/reconcile": (c) => ({
    entity: "account",
    entityId: idParam(c),
    summary: field(c.result, "adjustmentId") ? `Cuenta conciliada con un ajuste de ${eur(field(c.result, "difference"))}` : "Cuenta conciliada",
  }),
  "POST /api/accounts/:id/valuations": (c) => ({ entity: "account", entityId: idParam(c), summary: `Valor actualizado: ${eur(c.body.value)}` }),
  "DELETE /api/accounts/:id/valuations/:valuationId": (c) => ({ entity: "account", entityId: idParam(c), summary: "Valoración eliminada" }),
  // Categorías y reglas
  "POST /api/categories/": (c) => ({ entity: "category", summary: named("Categoría creada", c.body.name) }),
  "PUT /api/categories/:id": (c) => ({ entity: "category", entityId: idParam(c), summary: named("Categoría editada", c.body.name) }),
  "DELETE /api/categories/:id": (c) => ({ entity: "category", entityId: idParam(c), summary: "Categoría eliminada" }),
  "POST /api/categories/groups": (c) => ({ entity: "category", summary: named("Grupo de categorías creado", c.body.name) }),
  "PUT /api/categories/groups/:id": (c) => ({ entity: "category", summary: named("Grupo de categorías editado", c.body.name) }),
  "DELETE /api/categories/groups/:id": () => ({ entity: "category", summary: "Grupo de categorías eliminado" }),
  "POST /api/categories/seed-defaults": () => ({ entity: "category", summary: "Creadas las categorías por defecto" }),
  "POST /api/category-rules/": (c) => ({ entity: "rule", summary: named("Regla de categoría creada", c.body.match) }),
  "PUT /api/category-rules/:id": (c) => ({ entity: "rule", summary: named("Regla de categoría editada", c.body.match) }),
  "DELETE /api/category-rules/:id": () => ({ entity: "rule", summary: "Regla de categoría eliminada" }),
  "POST /api/category-rules/apply": (c) => {
    const n = Number(field(c.result, "updated")) || 0;
    return n ? { entity: "rule", summary: `Reglas aplicadas: ${plural(n, "movimiento categorizado", "movimientos categorizados")}` } : null;
  },
  // Presupuesto
  "PUT /api/budgets/": (c) => ({ entity: "budget", summary: `Asignado ${eur(c.body.assigned)} en ${str(c.body.month) ?? "el presupuesto"}` }),
  "POST /api/budgets/move": (c) => ({ entity: "budget", summary: `Movidos ${eur(c.body.amount)} entre categorías` }),
  "POST /api/budgets/auto-assign": (c) => ({ entity: "budget", summary: `Asignación automática${str(c.body.month) ? ` en ${str(c.body.month)}` : ""}` }),
  "PUT /api/budgets/targets": () => ({ entity: "budget", summary: "Objetivo de una categoría guardado" }),
  "DELETE /api/budgets/targets/:categoryId": () => ({ entity: "budget", summary: "Objetivo de una categoría quitado" }),
  // Importaciones y copias
  "POST /api/import/csv": (c) => {
    const s = field(c.result, "summary") as Record<string, unknown> | undefined;
    return { entity: "import", summary: `Importados del banco ${plural(Number(s?.transactions) || 0, "movimiento", "movimientos")}${Number(s?.duplicates) ? ` (${Number(s?.duplicates)} repetidos omitidos)` : ""}` };
  },
  "POST /api/import/ynab": (c) => {
    const s = field(c.result, "summary") as Record<string, unknown> | undefined;
    return { entity: "import", summary: `Importados de YNAB ${plural(Number(s?.transactions) || 0, "movimiento", "movimientos")}` };
  },
  "DELETE /api/import/batches/:batchId": (c) => ({ entity: "import", summary: `Importación deshecha: ${plural(Number(field(c.result, "deleted")) || 0, "movimiento eliminado", "movimientos eliminados")}` }),
  "POST /api/import/backup": (c) => (c.query.dryRun === "true" ? null : { entity: "backup", summary: "Copia de seguridad restaurada (los datos anteriores se sustituyeron)" }),
  // Nóminas
  "POST /api/payslips/upload": (c) => ({ entity: "payslip", summary: `Subidas ${plural(count(c.result), "nómina", "nóminas")}` }),
  "DELETE /api/payslips/:id": (c) => ({ entity: "payslip", entityId: idParam(c), summary: "Nómina eliminada" }),
  "PUT /api/payslips/:id/concepts": (c) => ({ entity: "payslip", entityId: idParam(c), summary: "Conceptos de una nómina corregidos" }),
  "POST /api/payslips/:id/reprocess": (c) => ({ entity: "payslip", entityId: idParam(c), summary: "Nómina reprocesada" }),
  "POST /api/payslips/reparse": (c) => (c.query.dryRun === "true" ? null : { entity: "payslip", summary: "Nóminas reprocesadas con el analizador actual" }),
  "POST /api/payslips/batch": (c) => ({ entity: "payslip", summary: `${plural(count(c.body.ids), "nómina", "nóminas")} ${PAYSLIP_BATCH[String(c.body.action)] ?? "cambiadas"} en lote` }),
  "PATCH /api/payslips/:id/type": (c) => ({ entity: "payslip", entityId: idParam(c), summary: c.body.payslipType === "extra" ? "Nómina marcada como paga extra" : "Nómina marcada como ordinaria" }),
  "PATCH /api/payslips/:id/profile": (c) => ({ entity: "payslip", entityId: idParam(c), summary: "Nómina movida a otro perfil" }),
  "PUT /api/payslips/:id/link": (c) => ({ entity: "payslip", entityId: idParam(c), summary: c.body.transactionId ? "Nómina enlazada con su ingreso" : "Nómina desenlazada de su ingreso" }),
  "POST /api/payslips/:id/ocr-text": (c) => ({ entity: "payslip", entityId: idParam(c), summary: "Nómina escaneada leída con OCR" }),
  // Perfiles
  "POST /api/profiles/": (c) => ({ entity: "profile", summary: named("Perfil creado", c.body.name) }),
  "PUT /api/profiles/:id": (c) => ({ entity: "profile", entityId: idParam(c), summary: named("Perfil editado", c.body.name) }),
  "DELETE /api/profiles/:id": () => ({ entity: "profile", summary: "Perfil eliminado con sus nóminas" }),
  // Alertas, objetivos, etiquetas, notas
  "POST /api/alerts/rules": (c) => ({ entity: "alert", summary: named("Regla de alerta creada", c.body.name) }),
  "PUT /api/alerts/rules/:id": (c) => ({ entity: "alert", summary: named("Regla de alerta editada", c.body.name) }),
  "DELETE /api/alerts/rules/:id": () => ({ entity: "alert", summary: "Regla de alerta eliminada" }),
  "POST /api/savings-goals/": (c) => ({ entity: "goal", summary: named("Objetivo de ahorro creado", c.body.name) }),
  "PATCH /api/savings-goals/:id": (c) => ({ entity: "goal", summary: named("Objetivo de ahorro editado", field(c.result, "name")) }),
  "DELETE /api/savings-goals/:id": () => ({ entity: "goal", summary: "Objetivo de ahorro eliminado" }),
  "POST /api/tags/": (c) => ({ entity: "tag", summary: named("Etiqueta creada", c.body.name) }),
  "PATCH /api/tags/:id": (c) => ({ entity: "tag", summary: named("Etiqueta editada", c.body.name) }),
  "DELETE /api/tags/:id": () => ({ entity: "tag", summary: "Etiqueta eliminada" }),
  "POST /api/notes/": () => ({ entity: "payslip", summary: "Nota añadida a una nómina" }),
  "DELETE /api/notes/:id": () => ({ entity: "payslip", summary: "Nota de una nómina eliminada" }),
  // Compartir
  "POST /api/sharing/invites": () => ({ entity: "sharing", summary: "Invitación creada para ver tus datos (solo lectura)" }),
  "DELETE /api/sharing/invites/:id": () => ({ entity: "sharing", summary: "Invitación cancelada" }),
  "POST /api/sharing/accept": (c) => ({ entity: "sharing", summary: named("Ahora puedes ver los datos de otra persona", (field(c.result, "owner") as Record<string, unknown> | undefined)?.name) }),
  "DELETE /api/sharing/viewers/:userId": () => ({ entity: "sharing", summary: "Quitado el acceso de una persona a tus datos" }),
  "DELETE /api/sharing/owners/:userId": () => ({ entity: "sharing", summary: "Has dejado de ver los datos de otra persona" }),
  // Datos de ejemplo
  "POST /api/demo/": () => ({ entity: "demo", summary: "Datos de ejemplo cargados" }),
  "DELETE /api/demo/": () => ({ entity: "demo", summary: "Datos de ejemplo quitados" }),
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Clave de la ruta que atendió la petición, o null si no se llegó a ninguna. */
export function routeKey(req: Request): string | null {
  if (!req.route?.path) return null;
  return `${req.method} ${req.baseUrl}${req.route.path}`;
}

/** Middleware: se monta antes de las rutas de /api. */
export function activityMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!MUTATING.has(req.method)) return next();
  let result: Ctx["result"] = null;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (body && typeof body === "object") result = body as Ctx["result"];
    return json(body);
  };
  res.on("finish", () => {
    if (res.statusCode >= 400 || !req.user) return;
    const key = routeKey(req);
    const describe = key ? ACTIVITY[key] : undefined;
    if (!describe) return;
    let entry: ReturnType<Describe> = null;
    try {
      entry = describe({
        params: (req.params ?? {}) as Record<string, string>,
        body: (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>,
        query: req.query as Record<string, unknown>,
        result,
      });
    } catch (err) {
      logger.warn({ err, key }, "No se pudo describir la actividad");
    }
    if (entry) void logActivity(req.user.userId, entry);
  });
  next();
}

export async function logActivity(userId: number, entry: { entity: string; summary: string; entityId?: number | null }): Promise<void> {
  try {
    await db.insert(activityLog).values({
      userId,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
    });
  } catch (err) {
    logger.warn({ err }, "No se pudo apuntar la actividad");
  }
}

export async function listActivity(userId: number, opts: { before?: number; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = await db
    .select({ id: activityLog.id, entity: activityLog.entity, entityId: activityLog.entityId, summary: activityLog.summary, createdAt: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.userId, userId), opts.before ? lt(activityLog.id, opts.before) : undefined))
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);
  return { data: rows.slice(0, limit), nextBefore: rows.length > limit ? rows[limit - 1].id : null };
}

/** Lo de más de `days` días se borra (cron diario). */
export async function pruneActivity(days = 180): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const deleted = await db.delete(activityLog).where(lt(activityLog.createdAt, cutoff)).returning({ id: activityLog.id });
  return deleted.length;
}
