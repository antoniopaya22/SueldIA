import { Router } from "express";
import { db } from "../db/index.js";
import { payslips, payslipConcepts, profiles, transactions, accounts } from "../db/schema.js";
import { eq, and, asc, desc, ilike, or, ne, isNull, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { upload, validatePdfMagicBytes, fixFilenameEncoding } from "../middleware/upload.js";
import { parsePayslip } from "../parsers/parser-engine.js";
import { detectPayslipType, type ParsedPayslip } from "../parsers/concept-matcher.js";
import { matchConcepts } from "../parsers/formats/index.js";
import { createHash } from "node:crypto";
import { classifyConcept } from "../parsers/concept-classifier.js";
import { buildTaxSummary, diffConcepts } from "../services/payslip-compare.service.js";
import { z } from "zod";
import { validateIdParam } from "../middleware/params.js";
import { logger } from "../logger.js";
import { evaluateRulesForUser } from "../services/alerts.service.js";
import { scoreLinkCandidates, payslipReferenceDateMs } from "../services/payslip-links.service.js";
import { validatePayslip } from "../services/payslip-validation.service.js";

export const payslipsRouter = Router();
payslipsRouter.param("id", validateIdParam);

/** Returns the IDs of profiles owned by the authenticated user */
async function getUserProfileIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  return rows.map((r) => r.id);
}

// Upload one or more PDFs — se procesan en la propia petición (sin OCR el
// parseo es rápido, y así no se depende de que la función siga viva después
// de responder, algo que un entorno serverless no garantiza).
payslipsRouter.post(
  "/upload",
  upload.array("files", 20),
  fixFilenameEncoding,
  validatePdfMagicBytes,
  async (req, res, next) => {
    try {
      const { userId } = req.user!;
      const profileId = Number(req.body.profileId);
      if (!profileId)
        return res.status(400).json({ error: "profileId requerido" });

      const bodyType = req.body.payslipType;
      const manualType: "ordinal" | "extra" =
        bodyType === "extra" ? "extra" : "ordinal";

      // Verify the profile belongs to this user
      const [profile] = await db
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)));
      if (!profile)
        return res.status(403).json({ error: "Perfil no pertenece al usuario" });

      const files = req.files as Express.Multer.File[];
      if (!files?.length)
        return res.status(400).json({ error: "No se han subido archivos" });

      const results = [];

      for (const file of files) {
        // 1. Analizar en memoria. Antes se insertaba primero una fila
        //    "pending" y, si la función moría a mitad de tanda, quedaba así
        //    para siempre (sin texto, ni siquiera se podía reprocesar).
        let parsed: ParsedPayslip | null = null;
        try {
          parsed = await parsePayslip(file.buffer);
        } catch (err) {
          logger.error({ err }, "Parse error");
        }
        const contentHash = parsed ? hashText(parsed.rawText) : null;

        // 2. El mismo PDF ya subido a este perfil: no se guarda otra vez.
        if (contentHash) {
          const [existing] = await db
            .select()
            .from(payslips)
            .where(and(eq(payslips.profileId, profileId), eq(payslips.contentHash, contentHash)))
            .limit(1);
          if (existing) {
            const concepts = await db.select().from(payslipConcepts).where(eq(payslipConcepts.payslipId, existing.id));
            results.push({ ...existing, concepts, duplicateOfId: existing.id, alreadyUploaded: true });
            continue;
          }
        }

        // Auto-detección de paga extra: solo al subir, y solo para
        // "ascender" de ordinal a extra si el propio texto de la nómina lo
        // indica — nunca al revés. Así no pisa una corrección manual
        // posterior (PATCH /:id/type) en un reprocess/reparse futuro.
        const payslipType: "ordinal" | "extra" =
          manualType === "ordinal" && parsed && detectPayslipType(parsed.rawText) === "extra" ? "extra" : manualType;

        // 3. Una sola inserción, nómina y conceptos juntos.
        const { payslip: created, concepts } = await db.transaction(async (tx) => {
          const [payslip] = await tx
            .insert(payslips)
            .values({
              profileId,
              fileName: file.originalname,
              payslipType,
              contentHash,
              ...(parsed ? parsedPayslipValues(parsed) : { parsingStatus: "error" as const }),
            })
            .returning();
          const concepts = parsed && parsed.concepts.length > 0
            ? await tx.insert(payslipConcepts).values(parsed.concepts.map((c) => withKind({ ...c, payslipId: payslip.id }))).returning()
            : [];
          return { payslip, concepts };
        });
        // Métrica de calidad del analizador (sin datos personales): qué formato,
        // cómo acabó y cuánto tardó. Junto con payslips.parser_format/parse_ms
        // dice qué formato falla más y si un cambio del analizador mejora algo.
        logger.info(
          { parser: { format: parsed?.format ?? null, status: created.parsingStatus, ms: parsed?.parseMs ?? null, concepts: concepts.length } },
          "Nómina analizada",
        );

        // Aviso de posible duplicado (mismo perfil + periodo + tipo, contenido
        // distinto) — no bloquea (puede ser una nómina corregida a propósito).
        let duplicateOfId: number | null = null;
        if (created.periodYear && created.periodMonth && created.parsingStatus !== "error") {
          const [dup] = await db
            .select({ id: payslips.id })
            .from(payslips)
            .where(
              and(
                eq(payslips.profileId, profileId),
                eq(payslips.periodYear, created.periodYear),
                eq(payslips.periodMonth, created.periodMonth),
                eq(payslips.payslipType, created.payslipType),
                ne(payslips.id, created.id),
              ),
            )
            .orderBy(payslips.id)
            .limit(1);
          duplicateOfId = dup?.id ?? null;
        }

        results.push({ ...created, concepts, duplicateOfId, alreadyUploaded: false });
      }

      // Best-effort: si falla, la subida ya ha ido bien y no debe reportarse
      // como error al usuario — el cron diario evaluará estas reglas de todos modos.
      try {
        await evaluateRulesForUser(userId);
      } catch (err) {
        logger.error({ err, userId }, "Error evaluando alertas tras la subida");
      }

      res.status(201).json(results);
    } catch (err) {
      next(err);
    }
  }
);

const payslipListQuerySchema = z.object({
  profileId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  search: z.string().max(200).optional(),
  status: z.enum(["pending", "parsed", "error", "review"]).optional(),
  type: z.enum(["ordinal", "extra"]).optional(),
  sortBy: z.enum(["period", "fileName", "grossSalary", "netSalary", "parsingStatus"]).default("period"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// List payslips with pagination and search
payslipsRouter.get("/", async (req, res, next) => {
  try {
    const parsed = payslipListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    if (userProfileIds.length === 0)
      return res.json({ data: [], total: 0, page: 1, limit: 50 });

    const { profileId, year, search, status, type, sortBy, sortDir, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [
      sql`${payslips.profileId} IN (${sql.join(userProfileIds.map((id) => sql`${id}`), sql`, `)})`
    ];
    if (profileId) {
      if (!userProfileIds.includes(profileId))
        return res.json({ data: [], total: 0, page, limit });
      conditions.push(eq(payslips.profileId, profileId));
    }
    if (year) conditions.push(eq(payslips.periodYear, year));
    if (status) conditions.push(eq(payslips.parsingStatus, status));
    if (type) conditions.push(eq(payslips.payslipType, type));
    if (search) {
      conditions.push(
        or(ilike(payslips.fileName, `%${search}%`), ilike(payslips.company, `%${search}%`))!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const sortOrder = sortDir === "asc" ? asc : desc;
    const orderByClauses = sortBy === "period"
      ? [sortOrder(payslips.periodYear), sortOrder(payslips.periodMonth), desc(payslips.id)]
      : sortBy === "fileName"
      ? [sortOrder(payslips.fileName), desc(payslips.periodYear), desc(payslips.periodMonth), desc(payslips.id)]
      : sortBy === "grossSalary"
      ? [sortOrder(payslips.grossSalary), desc(payslips.periodYear), desc(payslips.periodMonth), desc(payslips.id)]
      : sortBy === "netSalary"
      ? [sortOrder(payslips.netSalary), desc(payslips.periodYear), desc(payslips.periodMonth), desc(payslips.id)]
      : [sortOrder(payslips.parsingStatus), desc(payslips.periodYear), desc(payslips.periodMonth), desc(payslips.id)];

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(payslips)
      .where(where);

    const result = await db
      .select()
      .from(payslips)
      .where(where)
      .orderBy(...orderByClauses)
      .limit(limit)
      .offset(offset);

    res.json({ data: result, total: count, page, limit });
  } catch (err) {
    next(err);
  }
});

// Get single payslip with concepts
// Resumen fiscal de un año y perfil (para cotejar con el certificado de
// retenciones de la empresa al hacer la Renta).
const taxSummaryQuery = z.object({
  profileId: z.coerce.number().int().positive().max(2_147_483_647),
  year: z.coerce.number().int().min(1990).max(2100),
});
payslipsRouter.get("/tax-summary", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = taxSummaryQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Parámetros inválidos", details: parsed.error.flatten().fieldErrors });
    const userProfileIds = await getUserProfileIds(userId);
    if (!userProfileIds.includes(parsed.data.profileId)) return res.status(404).json({ error: "Perfil no encontrado" });
    const rows = await db
      .select({ id: payslips.id, grossSalary: payslips.grossSalary, netSalary: payslips.netSalary, periodMonth: payslips.periodMonth, payslipType: payslips.payslipType })
      .from(payslips)
      .where(and(
        eq(payslips.profileId, parsed.data.profileId),
        eq(payslips.periodYear, parsed.data.year),
        ne(payslips.parsingStatus, "error"),
      ));
    const concepts = rows.length
      ? await db.select().from(payslipConcepts).where(inArray(payslipConcepts.payslipId, rows.map((r) => r.id)))
      : [];
    res.json(buildTaxSummary(parsed.data.year, rows, concepts));
  } catch (err) {
    next(err);
  }
});

// Comparar una nómina con la del mes anterior y con la del mismo mes del año
// pasado (mismo perfil y tipo), concepto a concepto; y la anterior/siguiente
// para navegar entre nóminas desde el detalle.
payslipsRouter.get("/:id/compare", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [p] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!p || !userProfileIds.includes(p.profileId)) return res.status(404).json({ error: "Nómina no encontrada" });
    if (!p.periodYear || !p.periodMonth) return res.json({ previous: null, lastYear: null, prevId: null, nextId: null });

    const siblings = await db
      .select({ id: payslips.id, periodYear: payslips.periodYear, periodMonth: payslips.periodMonth, grossSalary: payslips.grossSalary, netSalary: payslips.netSalary })
      .from(payslips)
      .where(and(eq(payslips.profileId, p.profileId), eq(payslips.payslipType, p.payslipType), ne(payslips.parsingStatus, "error")))
      .orderBy(asc(payslips.periodYear), asc(payslips.periodMonth), asc(payslips.id));
    const withPeriod = siblings.filter((s) => s.periodYear && s.periodMonth);
    const idx = withPeriod.findIndex((s) => s.id === id);
    const value = (s: { periodYear: number | null; periodMonth: number | null }) => s.periodYear! * 12 + s.periodMonth!;
    const previous = idx > 0 ? withPeriod[idx - 1] : null;
    const lastYear = withPeriod.find((s) => value(s) === value(p) - 12) ?? null;

    const ids = [id, previous?.id, lastYear?.id].filter((x): x is number => !!x);
    const concepts = await db.select().from(payslipConcepts).where(inArray(payslipConcepts.payslipId, ids));
    const of = (pid: number) => concepts.filter((c) => c.payslipId === pid);
    const compareWith = (other: typeof previous) =>
      other && {
        id: other.id,
        periodYear: other.periodYear,
        periodMonth: other.periodMonth,
        grossSalary: other.grossSalary,
        netSalary: other.netSalary,
        concepts: diffConcepts(of(id), of(other.id)),
      };
    res.json({
      previous: compareWith(previous),
      lastYear: compareWith(lastYear),
      prevId: previous?.id ?? null,
      nextId: idx >= 0 && idx < withPeriod.length - 1 ? withPeriod[idx + 1].id : null,
    });
  } catch (err) {
    next(err);
  }
});

payslipsRouter.get("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db
      .select()
      .from(payslips)
      .where(eq(payslips.id, id));

    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    const concepts = await db
      .select()
      .from(payslipConcepts)
      .where(eq(payslipConcepts.payslipId, id));

    const [linkedTransaction] = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        amount: transactions.amount,
        date: transactions.date,
        payee: transactions.payee,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(eq(transactions.payslipId, id));

    const warnings = validatePayslip({
      payslipType: payslip.payslipType,
      grossSalary: payslip.grossSalary,
      netSalary: payslip.netSalary,
      concepts,
    });

    res.json({ ...payslip, concepts, linkedTransaction: linkedTransaction ?? null, warnings });
  } catch (err) {
    next(err);
  }
});

// Update concepts manually
const money = z.number().finite().min(-10_000_000).max(10_000_000);
const conceptSchema = z.object({
  concepts: z
    .array(
      z.object({
        category: z.enum(["devengo", "deduccion", "otros"]),
        name: z.string().trim().min(1).max(200),
        amount: money,
        isPercentage: z.boolean().optional(),
      }),
    )
    .max(200),
  // null = "no lo sé": se guarda vacío en vez de un 0 que contaría en medias y totales.
  grossSalary: money.nullable().optional(),
  netSalary: money.nullable().optional(),
  periodMonth: z.number().int().min(1).max(12).nullable().optional(),
  periodYear: z.number().int().min(1900).max(2100).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
});

payslipsRouter.put("/:id/concepts", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);

    // Verify ownership
    const [existing] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!existing || !userProfileIds.includes(existing.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    const parsed = conceptSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });

    const { concepts, ...meta } = parsed.data;
    // Sin periodo la nómina no se puede situar en ninguna serie: queda "para revisar".
    const periodMonth = meta.periodMonth === undefined ? existing.periodMonth : meta.periodMonth;
    const periodYear = meta.periodYear === undefined ? existing.periodYear : meta.periodYear;
    const parsingStatus = periodMonth && periodYear ? "parsed" : "review";

    // Igual que applyParsedResult: sustituir los conceptos es un delete +
    // insert, y a medias dejaba la nómina sin un solo concepto.
    await db.transaction(async (tx) => {
      await tx
        .update(payslips)
        .set({ ...meta, company: meta.company || null, parsingStatus, manuallyEdited: true })
        .where(eq(payslips.id, id));

      await tx.delete(payslipConcepts).where(eq(payslipConcepts.payslipId, id));
      if (concepts.length > 0) {
        await tx.insert(payslipConcepts).values(
          concepts.map((c) => withKind({ ...c, payslipId: id }))
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Reprocess a payslip — re-ejecuta el matcher sobre el texto ya guardado
// (útil tras mejoras del parser), no re-extrae de ningún archivo porque no
// se guarda ninguno.
payslipsRouter.post("/:id/reprocess", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db
      .select()
      .from(payslips)
      .where(eq(payslips.id, id));

    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    if (!payslip.rawText) {
      return res.status(400).json({ error: "Esta nómina no tiene texto guardado para reprocesar" });
    }

    await applyParsedResult(id, matchConcepts(payslip.rawText));

    const [updated] = await db
      .select()
      .from(payslips)
      .where(eq(payslips.id, id));
    const concepts = await db
      .select()
      .from(payslipConcepts)
      .where(eq(payslipConcepts.payslipId, id));

    res.json({ ...updated, concepts });
  } catch (err) {
    next(err);
  }
});

// ─── Vincular nómina con un ingreso de Finanzas ──────────────────
// Siempre a mano: esto solo sugiere candidatas, nunca crea ni enlaza nada
// por sí solo. El usuario confirma desde el detalle de la nómina.

payslipsRouter.get("/:id/link-suggestions", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    if (payslip.netSalary == null) return res.json({ data: [] });

    const candidates = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        amount: transactions.amount,
        date: transactions.date,
        payee: transactions.payee,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(eq(transactions.userId, userId), eq(transactions.type, "income"), isNull(transactions.payslipId)));

    const targetDate = payslipReferenceDateMs(payslip.periodYear, payslip.periodMonth);
    const scored = scoreLinkCandidates(candidates, payslip.netSalary, targetDate);

    res.json({ data: scored });
  } catch (err) {
    next(err);
  }
});

const linkSchema = z.object({ transactionId: z.number().int().positive().nullable() });

payslipsRouter.put("/:id/link", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten().fieldErrors });
    }

    if (parsed.data.transactionId === null) {
      await db
        .update(transactions)
        .set({ payslipId: null })
        .where(and(eq(transactions.payslipId, id), eq(transactions.userId, userId)));
      return res.json({ ok: true });
    }

    const [tx] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, parsed.data.transactionId), eq(transactions.userId, userId)));
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });
    if (tx.type !== "income") {
      return res.status(400).json({ error: "Solo se puede vincular una nómina a un ingreso" });
    }
    if (tx.payslipId && tx.payslipId !== id) {
      return res.status(409).json({ error: "Esa transacción ya está vinculada a otra nómina" });
    }

    // Libera primero cualquier transacción que hoy apunte a esta nómina —
    // la clave única de transactions.payslip_id no admite dos filas con el
    // mismo valor a la vez, así que reasignar sin soltar antes fallaría.
    await db.transaction(async (dbTx) => {
      await dbTx.update(transactions).set({ payslipId: null }).where(eq(transactions.payslipId, id));
      await dbTx.update(transactions).set({ payslipId: id }).where(eq(transactions.id, parsed.data.transactionId!));
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Delete payslip
payslipsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db
      .select()
      .from(payslips)
      .where(eq(payslips.id, id));

    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    await db.delete(payslips).where(eq(payslips.id, id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Update payslip type
const payslipTypeSchema = z.object({
  type: z.enum(["ordinal", "extra"]),
});

payslipsRouter.patch("/:id/type", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);

    const parsed = payslipTypeSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Tipo inválido", details: parsed.error.flatten().fieldErrors });

    const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });

    const [updated] = await db
      .update(payslips)
      .set({ payslipType: parsed.data.type })
      .where(eq(payslips.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Marcar como revisada sin tener que editar: el usuario ha mirado una nómina
// "para revisar" y está bien (p. ej. una sin conceptos que de verdad no los tiene).
payslipsRouter.patch("/:id/reviewed", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });
    // Sin periodo no se puede situar en ninguna serie: hay que editarla.
    if (!payslip.periodMonth || !payslip.periodYear)
      return res.status(400).json({ error: "Indica el periodo de la nómina antes de darla por revisada" });

    const [updated] = await db
      .update(payslips)
      .set({ parsingStatus: "parsed" })
      .where(and(eq(payslips.id, id), inArray(payslips.profileId, userProfileIds)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Mover a otro perfil (p. ej. se subió en el de la pareja por error).
const moveProfileSchema = z.object({ profileId: z.number().int().positive().max(2_147_483_647) });
payslipsRouter.patch("/:id/profile", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    const id = Number(req.params.id);
    const parsed = moveProfileSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Perfil inválido", details: parsed.error.flatten().fieldErrors });
    const [payslip] = await db.select().from(payslips).where(eq(payslips.id, id));
    if (!payslip || !userProfileIds.includes(payslip.profileId))
      return res.status(404).json({ error: "Nómina no encontrada" });
    if (!userProfileIds.includes(parsed.data.profileId))
      return res.status(404).json({ error: "Perfil no encontrado" });

    const [updated] = await db
      .update(payslips)
      .set({ profileId: parsed.data.profileId })
      .where(and(eq(payslips.id, id), inArray(payslips.profileId, userProfileIds)))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Reparse all payslips (useful after parser improvements) — igual que
// reprocess, sobre el rawText ya guardado de cada una.
payslipsRouter.post("/reparse", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const userProfileIds = await getUserProfileIds(userId);
    if (userProfileIds.length === 0)
      return res.json({ ok: true, reparsed: 0, errors: 0, skippedEdited: 0 });

    // ?force=true reprocesa también las corregidas a mano (pisando esas correcciones).
    const force = req.query.force === "true";
    const allPayslips = await db
      .select({ id: payslips.id, rawText: payslips.rawText, manuallyEdited: payslips.manuallyEdited })
      .from(payslips)
      .where(inArray(payslips.profileId, userProfileIds));
    const toReparse = allPayslips.filter((p) => p.rawText && (force || !p.manuallyEdited));
    const skippedEdited = allPayslips.filter((p) => p.rawText && !force && p.manuallyEdited).length;
    let success = 0;
    let errors = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < toReparse.length; i += BATCH_SIZE) {
      const batch = toReparse.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((p) => applyParsedResult(p.id, matchConcepts(p.rawText!))),
      );
      for (const r of results) {
        if (r.status === "fulfilled") success++;
        else errors++;
      }
    }

    res.json({ ok: true, reparsed: success, errors, skippedEdited });
  } catch (err) {
    next(err);
  }
});

// Persiste el resultado de un parseo/reparseo: metadatos + conceptos. Todo
// en una transacción — sin esto, un fallo justo entre el delete y el
// insert dejaba la nómina "parsed" pero sin un solo concepto.
async function applyParsedResult(payslipId: number, result: ReturnType<typeof matchConcepts>) {
  await db.transaction(async (tx) => {
    await tx
      .update(payslips)
      .set({ ...parsedPayslipValues(result), manuallyEdited: false })
      .where(eq(payslips.id, payslipId));

    await tx.delete(payslipConcepts).where(eq(payslipConcepts.payslipId, payslipId));

    if (result.concepts.length > 0) {
      await tx.insert(payslipConcepts).values(
        result.concepts.map((c) => withKind({ ...c, payslipId })),
      );
    }
  });
}

/** Columnas de la nómina a partir del resultado del analizador (subida y reprocesado). */
function parsedPayslipValues(result: ParsedPayslip) {
  return {
    rawText: result.rawText,
    grossSalary: result.grossSalary,
    netSalary: result.netSalary,
    periodMonth: result.periodMonth,
    periodYear: result.periodYear,
    company: result.company,
    parserFormat: result.format ?? null,
    // Solo al subir (al reprocesar no se vuelve a leer el PDF): undefined = no se toca.
    parseMs: result.parseMs,
    // Sin conceptos o sin periodo, la nómina necesita que el usuario la mire.
    parsingStatus: (result.concepts.length > 0 && result.periodMonth && result.periodYear ? "parsed" : "review") as "parsed" | "review",
  };
}

/** Añade el tipo semántico del concepto (IRPF, cotizaciones, salario base…). */
function withKind<T extends { name: string; category: "devengo" | "deduccion" | "otros" }>(c: T): T & { kind: string } {
  return { ...c, kind: classifyConcept(c.name, c.category) };
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
