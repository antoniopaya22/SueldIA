import { isValidIsoDate } from "../utils/dates.js";

// Extractos bancarios en CSV (cualquier banco): el usuario dice qué columna
// es cada cosa (o acepta la que proponemos) y se convierten en movimientos.
// Pensado para lo que exportan los bancos españoles: separador «;», números
// con coma decimal, fechas DD/MM/AAAA y codificación Windows-1252.

export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
export type DecimalSeparator = "comma" | "dot";

export interface BankCsvMapping {
  delimiter: string;
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: DateFormat;
  payeeColumn: number;
  memoColumn?: number | null;
  /** Una columna con signo, o dos (cargo y abono). */
  amountColumn?: number | null;
  debitColumn?: number | null;
  creditColumn?: number | null;
  decimal: DecimalSeparator;
}

export interface BankCsvRow {
  line: number;
  date: string;
  payee: string;
  memo: string;
  /** Con signo: positivo = entra dinero. */
  amount: number;
}

export interface BankCsvParseResult {
  rows: BankCsvRow[];
  /** Filas que no se pudieron leer, con el motivo. */
  errors: Array<{ line: number; reason: string }>;
}

/** Texto del fichero: UTF-8 si lo es; si no, Windows-1252 (lo habitual en bancos). */
export function decodeCsv(buffer: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  return text.replace(/^﻿/, "");
}

/** Separador más probable mirando las primeras líneas. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ";";
  let bestScore = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const counts = sample.map((l) => splitCsvLine(l, d).length);
    const consistent = counts.length > 0 && counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + (counts[0] ?? 0);
    if (counts[0] > 1 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Una línea CSV con comillas ("a;b" cuenta como un campo; "" es una comilla). */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

export function splitCsv(text: string, delimiter: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => splitCsvLine(l, delimiter));
}

export function parseAmount(raw: string, decimal: DecimalSeparator): number | null {
  let s = raw.replace(/[€\s ]|EUR/gi, "");
  if (s === "" || s === "-") return null;
  // Signo al final ("12,50-") o entre paréntesis ("(12,50)").
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  s = decimal === "comma" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim().slice(0, 10);
  let y: string, m: string, d: string;
  if (format === "YYYY-MM-DD") {
    const r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (!r) return null;
    [, y, m, d] = r;
  } else {
    const r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!r) return null;
    if (format === "DD/MM/YYYY") [, d, m, y] = r;
    else [, m, d, y] = r;
    if (y.length === 2) y = `20${y}`;
  }
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

export function parseBankCsv(text: string, mapping: BankCsvMapping): BankCsvParseResult {
  const lines = splitCsv(text, mapping.delimiter);
  const rows: BankCsvRow[] = [];
  const errors: BankCsvParseResult["errors"] = [];
  const first = mapping.hasHeader ? 1 : 0;

  for (let i = first; i < lines.length; i++) {
    const cells = lines[i];
    const line = i + 1;
    const cell = (idx: number | null | undefined) => (idx != null && idx >= 0 ? cells[idx] ?? "" : "");

    const date = parseDate(cell(mapping.dateColumn), mapping.dateFormat);
    if (!date) {
      // Líneas de pie o resumen del banco ("Saldo final…"): sin fecha, se ignoran sin ruido.
      if (cells.every((c) => c === "") || !/\d/.test(cell(mapping.dateColumn))) continue;
      errors.push({ line, reason: `Fecha no válida: «${cell(mapping.dateColumn)}»` });
      continue;
    }

    let amount: number | null;
    if (mapping.amountColumn != null) {
      amount = parseAmount(cell(mapping.amountColumn), mapping.decimal);
    } else {
      const debit = parseAmount(cell(mapping.debitColumn), mapping.decimal);
      const credit = parseAmount(cell(mapping.creditColumn), mapping.decimal);
      amount = debit == null && credit == null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount == null) {
      errors.push({ line, reason: "Importe no válido" });
      continue;
    }
    if (amount === 0) continue;

    rows.push({
      line,
      date,
      payee: cell(mapping.payeeColumn).slice(0, 200),
      memo: cell(mapping.memoColumn).slice(0, 500),
      amount: Math.round(amount * 100) / 100,
    });
  }
  return { rows, errors };
}

/**
 * Fila de cabecera: muchos bancos ponen antes unas líneas de título («Movimientos
 * de la cuenta…», «Titular…») con el mismo número de separadores pero casi
 * vacías. Es la primera fila con al menos 2 celdas y casi todas rellenas, sin
 * fechas, seguida de una fila que sí empieza a tener una fecha.
 */
export function findHeaderIndex(lines: string[][]): number {
  const DATE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;
  for (let i = 0; i < Math.min(lines.length - 1, 30); i++) {
    const cells = lines[i];
    const filled = cells.filter((c) => c !== "").length;
    if (filled < 2 || filled < cells.length - 1) continue;
    if (cells.some((c) => DATE.test(c))) continue;
    if (lines[i + 1].some((c) => DATE.test(c))) return i;
  }
  return 0;
}

/** Propuesta de mapeo a partir de la cabecera y de una fila de muestra. */
export function guessMapping(header: string[], sample: string[] | undefined, delimiter: string): BankCsvMapping {
  const norm = header.map((h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const find = (re: RegExp) => norm.findIndex((h) => re.test(h));
  const dateColumn = Math.max(0, find(/f\.? ?(operacion|valor|contable)|^fecha|date/));
  const payeeColumn = Math.max(0, find(/concepto|descripcion|beneficiario|comercio|detalle|payee|description/));
  const memoColumn = find(/observaciones|referencia|nota|memo|mas datos/);
  const amountColumn = find(/^importe|cantidad|amount|^importe ?\(?eur/);
  const debitColumn = find(/cargo|debe|debito|salida/);
  const creditColumn = find(/abono|haber|credito|ingreso|entrada/);
  const sampleDate = sample?.[dateColumn] ?? "";
  const sampleAmount = sample?.[amountColumn >= 0 ? amountColumn : debitColumn] ?? "";
  return {
    delimiter,
    hasHeader: true,
    dateColumn,
    dateFormat: /^\d{4}/.test(sampleDate) ? "YYYY-MM-DD" : "DD/MM/YYYY",
    payeeColumn,
    memoColumn: memoColumn >= 0 && memoColumn !== payeeColumn ? memoColumn : null,
    amountColumn: amountColumn >= 0 ? amountColumn : debitColumn >= 0 && creditColumn >= 0 ? null : amountColumn,
    debitColumn: amountColumn < 0 && debitColumn >= 0 ? debitColumn : null,
    creditColumn: amountColumn < 0 && creditColumn >= 0 ? creditColumn : null,
    decimal: /\d,\d{1,2}$/.test(sampleAmount.trim()) || delimiter === ";" ? "comma" : "dot",
  };
}
