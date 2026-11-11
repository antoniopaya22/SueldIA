import { randomUUID } from "node:crypto";
import { decodeCsv, detectDelimiter, findHeaderIndex, guessMapping, parseBankCsv, splitCsv } from "../parsers/bank-csv.js";
import { findRuleFor, loadRules } from "../services/category-rules.service.js";
import { todayIso } from "../utils/dates.js";
import { Router } from "express";
import { db } from "../db/index.js";
import { accounts, categoryGroups, categories, transactions } from "../db/schema.js";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { uploadCsv } from "../middleware/upload.js";
import {
  parseYnabCsv,
  isTransfer,
  getTransferTarget,
  isInflowCategory,
  type YnabRawRow,
} from "../parsers/ynab-csv-parser.js";
import { AppError } from "../middleware/error-handler.js";

export const importRouter = Router();

type NewTransaction = typeof transactions.$inferInsert;

const INSERT_CHUNK = 500;

function rowAmount(row: YnabRawRow): number {
  return row.inflow > 0 && row.outflow === 0 ? row.inflow : row.outflow;
}

// Import YNAB CSV/TSV. Con ?dryRun=true solo calcula el resumen, sin escribir
// nada. La importación real va en una transacción y con inserciones por lotes:
// la BBDD está en otra región y una inserción por fila no cabe en el tiempo de
// una función serverless con exports de miles de movimientos.
importRouter.post("/ynab", uploadCsv.single("file"), async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const dryRun = req.query.dryRun === "true";
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No se ha subido ningún archivo" });
    }

    let parsed: ReturnType<typeof parseYnabCsv>;
    try {
      parsed = parseYnabCsv(file.buffer.toString("utf-8"));
    } catch (err) {
      // El parser lanza Error con un mensaje ya pensado para el usuario
      // (p. ej. fichero vacío) — sin esto llegaba como 500 genérico.
      throw new AppError(400, err instanceof Error ? err.message : "No se pudo leer el archivo");
    }
    if (parsed.rows.length === 0) {
      throw new AppError(400, "El archivo no contiene movimientos de YNAB");
    }
    // Una fecha que no existe (o en formato US, MM/DD/YYYY) se insertaba tal
    // cual y luego dejaba en blanco toda la analítica de finanzas.
    if (parsed.invalidDateLines.length > 0) {
      const lines = parsed.invalidDateLines;
      const shown = lines.slice(0, 5).join(", ") + (lines.length > 5 ? ` y ${lines.length - 5} más` : "");
      throw new AppError(
        400,
        `Hay ${lines.length} ${lines.length === 1 ? "fila" : "filas"} con una fecha no válida (fila ${shown}). ` +
          "El export de YNAB debe usar fechas DD/MM/AAAA.",
      );
    }

    const existingAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    const accountMap = new Map(existingAccounts.map((a) => [a.name, a.id]));

    // Un movimiento ya existente (misma fecha, importe, cuenta y beneficiario)
    // se omite, así se puede reimportar un export más reciente sin duplicar.
    const existingTx = await db
      .select({ date: transactions.date, amount: transactions.amount, accountId: transactions.accountId, payee: transactions.payee })
      .from(transactions)
      .where(eq(transactions.userId, userId));
    // Recuento (no conjunto): con un café ya apuntado y dos cafés iguales el
    // mismo día en el fichero, antes se descartaban los dos.
    const existingCounts = new Map<string, number>();
    for (const t of existingTx) {
      const key = `${t.date}|${t.amount}|${t.accountId}|${t.payee ?? ""}`;
      existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
    }
    const makeDuplicateChecker = () => {
      const remaining = new Map(existingCounts);
      return (row: YnabRawRow, accountId: number | undefined) => {
        if (accountId === undefined) return false;
        const key = `${row.date}|${rowAmount(row)}|${accountId}|${row.payee || ""}`;
        const n = remaining.get(key) ?? 0;
        if (n === 0) return false;
        remaining.set(key, n - 1);
        return true;
      };
    };
    const isDuplicate = makeDuplicateChecker();

    const baseSummary = {
      accounts: parsed.accounts.length,
      categoryGroups: parsed.categoryGroups.size,
      categories: Array.from(parsed.categoryGroups.values()).reduce((sum, set) => sum + set.size, 0),
      dateRange: parsed.dateRange,
    };

    if (dryRun) {
      // Vista previa: mismos números que dará la importación real («nuevos»
      // = los que se van a crear; antes el contador incluía los duplicados)
      // y una muestra de filas con su estado.
      let newCount = 0;
      let duplicates = 0;
      let zero = 0;
      const sample: Array<{ date: string; account: string; payee: string; category: string; amount: number; status: "new" | "duplicate" | "skipped" }> = [];
      for (const row of parsed.rows) {
        const status = rowAmount(row) === 0 ? "skipped" : isDuplicate(row, accountMap.get(row.account)) ? "duplicate" : "new";
        if (status === "skipped") zero++;
        else if (status === "duplicate") duplicates++;
        else newCount++;
        if (sample.length < 100) {
          sample.push({
            date: row.date,
            account: row.account,
            payee: row.payee,
            category: row.category ? `${row.categoryGroup} › ${row.category}` : "",
            amount: row.inflow > 0 ? row.inflow : -row.outflow,
            status,
          });
        }
      }
      return res.json({
        ok: true,
        dryRun: true,
        summary: { ...baseSummary, transactions: newCount, duplicates, skippedZero: zero },
        newAccounts: parsed.accounts.filter((name) => !accountMap.has(name)),
        sample,
      });
    }

    const batchId = randomUUID();

    const result = await db.transaction(async (tx) => {
      // 1. Cuentas que no existan
      const newAccounts = parsed.accounts.filter((name) => !accountMap.has(name));
      if (newAccounts.length > 0) {
        const created = await tx
          .insert(accounts)
          .values(newAccounts.map((name) => ({ userId, name, type: inferAccountType(name) })))
          .returning({ id: accounts.id, name: accounts.name });
        for (const a of created) accountMap.set(a.name, a.id);
      }

      // 2. Grupos y categorías que no existan
      const existingGroups = await tx.select().from(categoryGroups).where(eq(categoryGroups.userId, userId));
      const groupMap = new Map(existingGroups.map((g) => [g.name, g.id]));
      const newGroups = [...parsed.categoryGroups.keys()].filter((name) => !groupMap.has(name));
      if (newGroups.length > 0) {
        const created = await tx
          .insert(categoryGroups)
          .values(newGroups.map((name) => ({ userId, name })))
          .returning({ id: categoryGroups.id, name: categoryGroups.name });
        for (const g of created) groupMap.set(g.name, g.id);
      }

      const groupNameById = new Map([...groupMap].map(([name, id]) => [id, name]));
      const groupIds = [...groupMap.values()];
      const userCats = groupIds.length
        ? await tx.select().from(categories).where(inArray(categories.groupId, groupIds))
        : [];
      const catMap = new Map<string, number>(); // "grupo|categoría" → id
      for (const cat of userCats) {
        const groupName = groupNameById.get(cat.groupId);
        if (groupName) catMap.set(`${groupName}|${cat.name}`, cat.id);
      }

      const newCats: { groupId: number; name: string; key: string }[] = [];
      for (const [groupName, catNames] of parsed.categoryGroups) {
        const groupId = groupMap.get(groupName)!;
        for (const name of catNames) {
          const key = `${groupName}|${name}`;
          if (!catMap.has(key)) newCats.push({ groupId, name, key });
        }
      }
      if (newCats.length > 0) {
        const created = await tx
          .insert(categories)
          .values(newCats.map(({ groupId, name }) => ({ groupId, name })))
          .returning({ id: categories.id });
        created.forEach((c, i) => catMap.set(newCats[i].key, c.id));
      }

      // 3. Movimientos (se omiten los ya existentes)
      let skipped = 0;
      const pending = parsed.rows.filter((row) => {
        if (rowAmount(row) === 0 || !accountMap.has(row.account)) return false;
        if (isDuplicate(row, accountMap.get(row.account))) {
          skipped++;
          return false;
        }
        return true;
      });

      const toInsert = (row: YnabRawRow, fields: Partial<NewTransaction>): NewTransaction => ({
        userId,
        accountId: accountMap.get(row.account)!,
        categoryId: null,
        type: "transfer",
        amount: rowAmount(row),
        date: row.date,
        payee: row.payee || null,
        memo: row.memo || null,
        cleared: row.cleared,
        flag: row.flag || null,
        importedFrom: "ynab",
        importBatchId: batchId,
        ...fields,
      });

      const regular: NewTransaction[] = pending
        .filter((row) => !isTransfer(row.payee))
        .map((row) =>
          toInsert(row, {
            type: row.inflow > 0 && row.outflow === 0 ? "income" : "expense",
            categoryId:
              row.categoryGroup && row.category && !isInflowCategory(row.categoryGroup)
                ? catMap.get(`${row.categoryGroup}|${row.category}`) ?? null
                : null,
          }),
        );
      for (let i = 0; i < regular.length; i += INSERT_CHUNK) {
        await tx.insert(transactions).values(regular.slice(i, i + INSERT_CHUNK));
      }

      // Traspasos: la salida de A a "Transfer : B" se empareja con la entrada
      // en B desde "Transfer : A" (mismo día e importe).
      const transfers = pending
        .filter((row) => isTransfer(row.payee))
        .map((row) => ({ row, side: row.outflow > 0 ? ("out" as const) : ("in" as const) }));
      const matched = new Set<number>();
      const pairs: { out: YnabRawRow; in: YnabRawRow | null }[] = [];
      transfers.forEach((entry, i) => {
        if (entry.side !== "out" || matched.has(i)) return;
        const target = getTransferTarget(entry.row.payee);
        const j = transfers.findIndex(
          (other, k) =>
            k !== i &&
            !matched.has(k) &&
            other.side === "in" &&
            other.row.account === target &&
            Math.abs(other.row.inflow - entry.row.outflow) < 0.01 &&
            other.row.date === entry.row.date,
        );
        matched.add(i);
        if (j >= 0) matched.add(j);
        pairs.push({ out: entry.row, in: j >= 0 ? transfers[j].row : null });
      });

      for (let i = 0; i < pairs.length; i += INSERT_CHUNK) {
        const chunk = pairs.slice(i, i + INSERT_CHUNK);
        const outIds = await tx
          .insert(transactions)
          .values(chunk.map((p) => toInsert(p.out, {})))
          .returning({ id: transactions.id });
        const linked = chunk.map((p, k) => ({ inRow: p.in, outId: outIds[k].id })).filter((p) => p.inRow);
        if (linked.length === 0) continue;
        const inIds = await tx
          .insert(transactions)
          .values(linked.map((p) => toInsert(p.inRow!, { transferId: p.outId })))
          .returning({ id: transactions.id });
        const links = linked.map((p, k) => sql`(${p.outId}::int, ${inIds[k].id}::int)`);
        await tx.execute(
          sql`update transactions as t set transfer_id = v.in_id
              from (values ${sql.join(links, sql`, `)}) as v(out_id, in_id)
              where t.id = v.out_id`,
        );
      }

      // Entradas sin su salida en el export (0 = centinela de entrada huérfana)
      const orphans = transfers
        .filter((entry, i) => !matched.has(i))
        .map((entry) => toInsert(entry.row, { transferId: entry.side === "in" ? 0 : null }));
      for (let i = 0; i < orphans.length; i += INSERT_CHUNK) {
        await tx.insert(transactions).values(orphans.slice(i, i + INSERT_CHUNK));
      }

      const imported = regular.length + pairs.length + pairs.filter((p) => p.in).length + orphans.length;
      return { imported, skipped };
    });

    res.status(201).json({
      ok: true,
      batchId,
      summary: { ...baseSummary, transactions: result.imported, duplicates: result.skipped },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Extractos bancarios (CSV de cualquier banco) ───────────────
const bankMappingSchema = z.object({
  delimiter: z.enum([";", ",", "\t", "|"]),
  hasHeader: z.boolean(),
  dateColumn: z.number().int().min(0).max(100),
  dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]),
  payeeColumn: z.number().int().min(0).max(100),
  memoColumn: z.number().int().min(0).max(100).nullish(),
  amountColumn: z.number().int().min(0).max(100).nullish(),
  debitColumn: z.number().int().min(0).max(100).nullish(),
  creditColumn: z.number().int().min(0).max(100).nullish(),
  decimal: z.enum(["comma", "dot"]),
}).refine((m) => m.amountColumn != null || (m.debitColumn != null && m.creditColumn != null), {
  message: "Indica la columna del importe o las de cargo y abono",
});

// Primer paso: leer el fichero y proponer qué columna es cada cosa.
importRouter.post("/csv/inspect", uploadCsv.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se ha subido ningún archivo" });
    const text = decodeCsv(req.file.buffer);
    const delimiter = detectDelimiter(text);
    const lines = splitCsv(text, delimiter);
    if (lines.length < 2) return res.status(400).json({ error: "El archivo está vacío o tiene una sola línea" });
    // Algunos bancos ponen unas líneas de cabecera antes de la tabla: se
    // toma como cabecera la primera fila con el número de columnas habitual.
    const headerIndex = findHeaderIndex(lines);
    const header = lines[headerIndex];
    res.json({
      delimiter,
      headerIndex,
      header,
      sample: lines.slice(headerIndex + 1, headerIndex + 9),
      totalLines: lines.length - headerIndex - 1,
      mapping: guessMapping(header, lines[headerIndex + 1], delimiter),
    });
  } catch (err) {
    next(err);
  }
});

// Segundo paso: vista previa (?dryRun=true) o importación a una cuenta.
importRouter.post("/csv", uploadCsv.single("file"), async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const dryRun = req.query.dryRun === "true";
    if (!req.file) return res.status(400).json({ error: "No se ha subido ningún archivo" });
    const accountId = Number(req.body.accountId);
    const headerIndex = Math.max(0, Number(req.body.headerIndex) || 0);
    let mappingRaw: unknown;
    try {
      mappingRaw = JSON.parse(String(req.body.mapping ?? ""));
    } catch {
      return res.status(400).json({ error: "Mapeo de columnas no válido" });
    }
    const mapping = bankMappingSchema.safeParse(mappingRaw);
    if (!mapping.success) {
      return res.status(400).json({ error: "Mapeo de columnas no válido", details: mapping.error.flatten().fieldErrors });
    }
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    if (!account) return res.status(404).json({ error: "Cuenta no encontrada" });

    const text = decodeCsv(req.file.buffer).split(/\r?\n/).filter((l) => l.trim() !== "").slice(headerIndex).join("\n");
    const parsed = parseBankCsv(text, mapping.data);
    // Números de línea del fichero original (se recortaron las líneas de título).
    for (const e of parsed.errors) e.line += headerIndex;
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: "No se ha podido leer ningún movimiento con estas columnas", errors: parsed.errors.slice(0, 20) });
    }

    // Duplicados por recuento contra lo que ya hay en esa cuenta.
    const existing = await db
      .select({ date: transactions.date, amount: transactions.amount, type: transactions.type, payee: transactions.payee })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId)));
    const counts = new Map<string, number>();
    const keyOf = (date: string, signed: number, payee: string | null) => `${date}|${signed}|${(payee ?? "").toLowerCase()}`;
    for (const t of existing) {
      const signed = t.type === "income" ? t.amount : -t.amount;
      const k = keyOf(t.date, signed, t.payee);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const isDuplicate = (date: string, amount: number, payee: string) => {
      const k = keyOf(date, amount, payee || null);
      const n = counts.get(k) ?? 0;
      if (n === 0) return false;
      counts.set(k, n - 1);
      return true;
    };
    const fresh = parsed.rows.filter((r) => !isDuplicate(r.date, r.amount, r.payee));
    const duplicates = parsed.rows.length - fresh.length;

    if (dryRun) {
      const freshSet = new Set(fresh);
      return res.json({
        ok: true,
        dryRun: true,
        summary: { transactions: fresh.length, duplicates, errors: parsed.errors.length },
        errors: parsed.errors.slice(0, 20),
        sample: parsed.rows.slice(0, 100).map((r) => ({
          date: r.date, account: "", payee: r.payee, category: "", amount: r.amount,
          status: freshSet.has(r) ? "new" : "duplicate",
        })),
      });
    }

    // Categoría con las reglas del usuario («si el beneficiario contiene…»).
    const rules = await loadRules(userId);
    const batchId = randomUUID();
    const today = todayIso();
    const values = fresh.map((r) => ({
      userId,
      accountId,
      type: (r.amount > 0 ? "income" : "expense") as "income" | "expense",
      amount: Math.abs(r.amount),
      date: r.date,
      payee: r.payee || null,
      memo: r.memo || null,
      categoryId: findRuleFor({ payee: r.payee, memo: r.memo, type: r.amount > 0 ? "income" : "expense", amount: Math.abs(r.amount), accountId }, rules),
      // Lo que ya aparece en el extracto, el banco ya lo ha cobrado o pagado.
      cleared: r.date <= today,
      importedFrom: "csv",
      importBatchId: batchId,
    }));
    await db.transaction(async (tx) => {
      for (let i = 0; i < values.length; i += INSERT_CHUNK) {
        await tx.insert(transactions).values(values.slice(i, i + INSERT_CHUNK));
      }
    });
    res.status(201).json({
      ok: true,
      batchId,
      summary: {
        transactions: values.length,
        duplicates,
        errors: parsed.errors.length,
        categorized: values.filter((v) => v.categoryId != null).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Importaciones hechas (para poder deshacerlas).
importRouter.get("/batches", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const rows = await db
      .select({
        batchId: transactions.importBatchId,
        importedAt: sql<string>`min(${transactions.createdAt})`,
        count: sql<number>`count(*)::int`,
        from: sql<string>`min(${transactions.date})`,
        to: sql<string>`max(${transactions.date})`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNotNull(transactions.importBatchId)))
      .groupBy(transactions.importBatchId)
      .orderBy(sql`min(${transactions.createdAt}) desc`)
      .limit(20);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Deshacer una importación: borra sus movimientos (las dos patas de cada
// traspaso llevan el mismo lote). Las cuentas y categorías que creó se
// quedan: pueden tener ya otros movimientos o asignaciones.
importRouter.delete("/batches/:batchId", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const batchId = z.string().uuid().safeParse(req.params.batchId);
    if (!batchId.success) return res.status(400).json({ error: "Importación no válida" });
    const deleted = await db
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.importBatchId, batchId.data)))
      .returning({ id: transactions.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Importación no encontrada" });
    res.json({ ok: true, deleted: deleted.length });
  } catch (err) {
    next(err);
  }
});

function inferAccountType(name: string): "bank" | "credit_card" | "cash" | "investment" | "other" {
  const lower = name.toLowerCase();
  if (lower.includes("tarjeta") || lower.includes("credito") || lower.includes("crédito")) {
    return "credit_card";
  }
  if (lower.includes("efectivo")) return "cash";
  if (lower.includes("ahorro") || lower.includes("inversión") || lower.includes("inversion")) {
    return "investment";
  }
  return "bank";
}
