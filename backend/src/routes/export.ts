import { gzipSync } from "node:zlib";
import { Router } from "express";
import { z } from "zod";
import { toCsv } from "../utils/csv.js";
import { toXlsx, XLSX_MIME, type XlsxColumn } from "../utils/xlsx.js";
import { amountRangeValid, amountRangeIssue, buildConditions, transactionFilterFields } from "../services/transaction-query.js";
import { db } from "../db/index.js";
import { buildFullExport } from "../services/backup-restore.service.js";
import {
  payslips,
  payslipConcepts,
  profiles,
  transactions,
  accounts,
  categories,
  categoryGroups,
} from "../db/schema.js";
import { eq, and, sql, asc } from "drizzle-orm";

export const exportRouter = Router();

// Exportación completa de todos los datos del usuario (derecho de
// portabilidad RGPD) — un único JSON con todo lo que hay en cada tabla que
// cuelga de su cuenta. A diferencia del export de arriba (solo nóminas,
// aplanado para CSV), este no filtra ni resume nada.
exportRouter.get("/all", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const data = await buildFullExport(userId);
    if (!data) return res.status(404).json({ error: "Usuario no encontrado" });
    res.setHeader("Content-Disposition", `attachment; filename="sueldia-datos-${userId}.json"`);
    // Comprimida si el navegador lo acepta (siempre): Vercel corta las
    // respuestas de más de 4,5 MB y un JSON con años de movimientos y el texto
    // de las nóminas puede acercarse; comprimido ocupa ~10 veces menos.
    const body = JSON.stringify(data);
    if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      return res.send(gzipSync(body));
    }
    res.type("json").send(body);
  } catch (err) {
    next(err);
  }
});

const PAYSLIP_CSV_HEADERS = [
  "Perfil", "Tipo", "Periodo", "Empresa", "Salario Bruto", "Salario Neto", "Devengos", "Deducciones", "Archivo", "Fecha Subida",
] as const;
const TRANSACTION_CSV_HEADERS = [
  "Fecha", "Tipo", "Importe", "Beneficiario", "Cuenta", "Grupo", "Categoría", "Nota", "Estado",
] as const;

const exportQuerySchema = z.object({
  profileId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  type: z.enum(["ordinal", "extra"]).optional(),
  format: z.enum(["csv", "json", "xlsx"]).default("csv"),
});

const PAYSLIP_XLSX_COLUMNS: XlsxColumn[] = [
  { header: "Perfil", width: 16 }, { header: "Tipo", width: 12 }, { header: "Periodo", width: 10 }, { header: "Empresa", width: 28 },
  { header: "Salario Bruto", type: "money", width: 15 }, { header: "Salario Neto", type: "money", width: 15 },
  { header: "Devengos", width: 50 }, { header: "Deducciones", width: 50 }, { header: "Archivo", width: 30 }, { header: "Fecha Subida", type: "date", width: 13 },
];

function sendXlsx(res: import("express").Response, filename: string, sheet: string, columns: XlsxColumn[], rows: unknown[][]) {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toXlsx(sheet, columns, rows as Parameters<typeof toXlsx>[2]));
}

exportRouter.get("/", async (req, res, next) => {
  try {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de consulta inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { userId } = req.user!;

    // Only user's profiles
    const userProfiles = await db.select().from(profiles).where(eq(profiles.userId, userId));
    const userProfileIds = userProfiles.map((p) => p.id);
    const { profileId, year, type, format } = parsed.data;

    // Sin nada que exportar: un fichero vacío del formato pedido (antes, el
    // texto "Sin datos" como CSV aunque se hubiera pedido JSON).
    const sendEmpty = () => {
      if (format === "json") {
        res.setHeader("Content-Disposition", 'attachment; filename="nominas.json"');
        return res.json([]);
      }
      if (format === "xlsx") return sendXlsx(res, "nominas.xlsx", "Nóminas", PAYSLIP_XLSX_COLUMNS, []);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="nominas.csv"');
      return res.send(toCsv(PAYSLIP_CSV_HEADERS, []));
    };

    if (userProfileIds.length === 0) return sendEmpty();

    const conditions = [eq(payslips.parsingStatus, "parsed")];
    if (profileId) {
      if (!userProfileIds.includes(profileId)) return sendEmpty();
      conditions.push(eq(payslips.profileId, profileId));
    } else {
      conditions.push(
        sql`${payslips.profileId} IN (${sql.join(userProfileIds.map((id) => sql`${id}`), sql`, `)})`
      );
    }
    if (year) conditions.push(eq(payslips.periodYear, year));
    if (type) conditions.push(eq(payslips.payslipType, type));

    const allPayslips = await db
      .select()
      .from(payslips)
      .where(and(...conditions))
      .orderBy(payslips.periodYear, payslips.periodMonth);

    const profileMap = new Map(userProfiles.map((p) => [p.id, p.name]));

    // Get concepts for all payslips
    const payslipIds = allPayslips.map((p) => p.id);
    let allConcepts: Array<{ payslipId: number; category: string; name: string; amount: number }> = [];

    if (payslipIds.length > 0) {
      allConcepts = await db
        .select({
          payslipId: payslipConcepts.payslipId,
          category: payslipConcepts.category,
          name: payslipConcepts.name,
          amount: payslipConcepts.amount,
        })
        .from(payslipConcepts)
        .where(
          sql`${payslipConcepts.payslipId} IN (${sql.join(
            payslipIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        );
    }

    const conceptsByPayslip = new Map<number, typeof allConcepts>();
    for (const c of allConcepts) {
      const list = conceptsByPayslip.get(c.payslipId) || [];
      list.push(c);
      conceptsByPayslip.set(c.payslipId, list);
    }

    // Build flat rows for CSV
    const rows = allPayslips.map((p) => {
      const concepts = conceptsByPayslip.get(p.id) || [];
      const devengos = concepts.filter((c) => c.category === "devengo");
      const deducciones = concepts.filter((c) => c.category === "deduccion");

      return {
        Perfil: profileMap.get(p.profileId) ?? "",
        Tipo: p.payslipType === "extra" ? "Paga Extra" : "Mensual",
        Periodo: p.periodMonth && p.periodYear ? `${String(p.periodMonth).padStart(2, "0")}/${p.periodYear}` : "",
        Empresa: p.company ?? "",
        "Salario Bruto": p.grossSalary ?? "",
        "Salario Neto": p.netSalary ?? "",
        Devengos: devengos.map((c) => `${c.name}: ${c.amount.toFixed(2).replace(".", ",")}`).join(" | "),
        Deducciones: deducciones.map((c) => `${c.name}: ${c.amount.toFixed(2).replace(".", ",")}`).join(" | "),
        Archivo: p.fileName,
        "Fecha Subida": p.createdAt,
      };
    });

    if (format === "xlsx") {
      return sendXlsx(res, "nominas.xlsx", "Nóminas", PAYSLIP_XLSX_COLUMNS, rows.map((row) => PAYSLIP_CSV_HEADERS.map((h) => {
        const v = row[h];
        return v === "" ? null : v;
      })));
    }
    if (format === "csv") {
      // Sin filas: CSV con solo la cabecera (antes, el texto "Sin datos").
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="nominas.csv"');
      res.send(toCsv(PAYSLIP_CSV_HEADERS, rows));
    } else if (format === "json") {
      res.setHeader("Content-Disposition", 'attachment; filename="nominas.json"');
      res.json(rows);
    } else {
      res.status(400).json({ error: "Formato no soportado. Usa csv o json" });
    }
  } catch (err) {
    next(err);
  }
});

// ─── Transaction Export ─────────────────────────────────────────
const transactionExportSchema = z
  .object({
    format: z.enum(["csv", "json", "xlsx"]).default("csv"),
    ...transactionFilterFields,
  })
  .refine(amountRangeValid, amountRangeIssue);

exportRouter.get("/transactions", async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = transactionExportSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Parámetros de exportación inválidos",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { format, ...filters } = parsed.data;
    const conditions = buildConditions(userId, filters);

    const rows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        type: transactions.type,
        amount: transactions.amount,
        payee: transactions.payee,
        memo: transactions.memo,
        cleared: transactions.cleared,
        accountName: accounts.name,
        categoryName: sql<string>`coalesce(${categories.name}, '')`,
        groupName: sql<string>`coalesce(${categoryGroups.name}, '')`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(and(...conditions))
      .orderBy(asc(transactions.date), asc(transactions.id));

    const exportRows = rows.map((r) => ({
      Fecha: r.date,
      Tipo: r.type === "expense" ? "Gasto" : r.type === "income" ? "Ingreso" : "Traspaso",
      Importe: r.amount,
      Beneficiario: r.payee ?? "",
      Cuenta: r.accountName,
      Grupo: r.groupName,
      Categoría: r.categoryName,
      Nota: r.memo ?? "",
      Estado: r.cleared ? "Liquidada" : "Pendiente",
    }));

    if (format === "json") {
      res.setHeader("Content-Disposition", 'attachment; filename="transacciones.json"');
      return res.json(exportRows);
    }
    if (format === "xlsx") {
      const columns: XlsxColumn[] = [
        { header: "Fecha", type: "date", width: 12 }, { header: "Tipo", width: 14 }, { header: "Importe", type: "money", width: 14 },
        { header: "Beneficiario", width: 30 }, { header: "Cuenta", width: 18 }, { header: "Grupo", width: 18 },
        { header: "Categoría", width: 20 }, { header: "Nota", width: 30 }, { header: "Estado", width: 12 },
      ];
      return sendXlsx(res, "transacciones.xlsx", "Movimientos", columns, exportRows.map((r) => TRANSACTION_CSV_HEADERS.map((h) => r[h])));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="transacciones.csv"');
    res.send(toCsv(TRANSACTION_CSV_HEADERS, exportRows));
  } catch (err) {
    next(err);
  }
});
