import { Router } from "express";
import { db } from "../db/index.js";
import { accounts, categoryGroups, categories, transactions } from "../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
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
    const existingSet = new Set(existingTx.map((t) => `${t.date}|${t.amount}|${t.accountId}|${t.payee ?? ""}`));
    const isDuplicate = (row: YnabRawRow, accountId: number | undefined) =>
      accountId !== undefined && existingSet.has(`${row.date}|${rowAmount(row)}|${accountId}|${row.payee || ""}`);

    const baseSummary = {
      accounts: parsed.accounts.length,
      categoryGroups: parsed.categoryGroups.size,
      categories: Array.from(parsed.categoryGroups.values()).reduce((sum, set) => sum + set.size, 0),
      dateRange: parsed.dateRange,
    };

    if (dryRun) {
      let count = 0;
      let duplicates = 0;
      for (const row of parsed.rows) {
        if (rowAmount(row) === 0) continue;
        count++;
        if (isDuplicate(row, accountMap.get(row.account))) duplicates++;
      }
      return res.json({ ok: true, dryRun: true, summary: { ...baseSummary, transactions: count, duplicates } });
    }

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
      summary: { ...baseSummary, transactions: result.imported, duplicates: result.skipped },
    });
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
