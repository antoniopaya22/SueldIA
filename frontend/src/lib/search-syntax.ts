// Búsqueda con sintaxis para ⌘K: «mercadona >50 oct», «nómina marzo 2025»,
// «gastos 20-40 mes pasado». Puro y probado: separa del texto libre los
// importes, las fechas y el tipo, y devuelve una descripción legible.

export interface ParsedQuery {
  /** Lo que queda para buscar por texto. */
  text: string;
  minAmount?: number;
  maxAmount?: number;
  /** Rango de fechas "YYYY-MM-DD" (incluidos). */
  from?: string;
  to?: string;
  /** Mes y año sueltos (para nóminas, que van por periodo y no por fecha). */
  month?: number;
  year?: number;
  kind?: "payslip" | "expense" | "income";
  /** Trozos reconocidos, para enseñarlos: «más de 50 €», «octubre 2026». */
  chips: string[];
}

const MONTHS: Array<[number, string[], string]> = [
  [1, ["enero", "ene"], "enero"],
  [2, ["febrero", "feb"], "febrero"],
  [3, ["marzo", "mar"], "marzo"],
  [4, ["abril", "abr"], "abril"],
  [5, ["mayo", "may"], "mayo"],
  [6, ["junio", "jun"], "junio"],
  [7, ["julio", "jul"], "julio"],
  [8, ["agosto", "ago"], "agosto"],
  [9, ["septiembre", "setiembre", "sept", "sep"], "septiembre"],
  [10, ["octubre", "oct"], "octubre"],
  [11, ["noviembre", "nov"], "noviembre"],
  [12, ["diciembre", "dic"], "diciembre"],
];

const KINDS: Array<[ParsedQuery["kind"], string[], string]> = [
  ["payslip", ["nomina", "nominas"], "nóminas"],
  ["expense", ["gasto", "gastos"], "gastos"],
  ["income", ["ingreso", "ingresos"], "ingresos"],
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
const fmtAmount = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 2 })} €`;
// «1.500» y «1.500,50» llevan punto de miles; «12.5» o «12,5», decimales.
const amountOf = (s: string) =>
  Number(/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", "."));
const AMOUNT = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

export function parseSearchQuery(raw: string, today: string): ParsedQuery {
  const [ty, tm] = today.split("-").map(Number);
  const out: ParsedQuery = { text: "", chips: [] };
  const rest: string[] = [];
  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  const setMonth = (m: number, y: number, label: string) => {
    Object.assign(out, monthRange(y, m), { month: m, year: y });
    out.chips.push(label);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const f = fold(tok).replace(/€$/, "");
    const next = tokens[i + 1] ? fold(tokens[i + 1]) : "";
    let m: RegExpMatchArray | null;

    // Importes: >50, >=50, <20, 20-40, =12,99
    if ((m = f.match(new RegExp(`^(>=?|<=?|=)${AMOUNT}$`)))) {
      const n = amountOf(m[2]);
      if (m[1].startsWith(">")) { out.minAmount = n; out.chips.push(`más de ${fmtAmount(n)}`); }
      else if (m[1].startsWith("<")) { out.maxAmount = n; out.chips.push(`menos de ${fmtAmount(n)}`); }
      else { out.minAmount = n; out.maxAmount = n; out.chips.push(fmtAmount(n)); }
      continue;
    }
    if ((m = f.match(new RegExp(`^${AMOUNT}-${AMOUNT}$`)))) {
      const a = amountOf(m[1]);
      const b = amountOf(m[2]);
      out.minAmount = Math.min(a, b);
      out.maxAmount = Math.max(a, b);
      out.chips.push(`entre ${fmtAmount(out.minAmount)} y ${fmtAmount(out.maxAmount)}`);
      continue;
    }

    // Tipo
    const kind = KINDS.find(([, words]) => words.includes(f));
    if (kind && !out.kind) { out.kind = kind[0]; out.chips.push(kind[2]); continue; }

    // Fechas relativas
    if (f === "hoy" || f === "ayer") {
      const d = new Date(`${today}T00:00:00Z`);
      if (f === "ayer") d.setUTCDate(d.getUTCDate() - 1);
      const iso = d.toISOString().slice(0, 10);
      out.from = iso; out.to = iso; out.chips.push(f);
      continue;
    }
    if ((f === "este" || f === "esta") && (next === "mes" || next === "ano" || next === "año")) {
      if (next === "mes") setMonth(tm, ty, "este mes");
      else { out.from = `${ty}-01-01`; out.to = `${ty}-12-31`; out.year = ty; out.chips.push("este año"); }
      i++;
      continue;
    }
    if ((f === "mes" || f === "ano" || f === "año") && next === "pasado") {
      if (f === "mes") setMonth(tm === 1 ? 12 : tm - 1, tm === 1 ? ty - 1 : ty, "el mes pasado");
      else { out.from = `${ty - 1}-01-01`; out.to = `${ty - 1}-12-31`; out.year = ty - 1; out.chips.push("el año pasado"); }
      i++;
      continue;
    }

    // Mes (con año opcional detrás: «marzo 2025», «marzo de 2025»)
    const month = MONTHS.find(([, words]) => words.includes(f));
    if (month) {
      let year: number | undefined;
      const after = next === "de" ? (tokens[i + 2] ?? "") : next;
      if (/^(19|20)\d{2}$/.test(after)) {
        year = Number(after);
        i += next === "de" ? 2 : 1;
      }
      // Sin año: el último que ya ha pasado (o el actual).
      const y = year ?? (month[0] > tm ? ty - 1 : ty);
      setMonth(month[0], y, `${month[2]} ${y}`);
      continue;
    }

    // Año suelto
    if (/^(19|20)\d{2}$/.test(f)) {
      const y = Number(f);
      out.from = `${y}-01-01`; out.to = `${y}-12-31`; out.year = y; out.chips.push(String(y));
      continue;
    }

    rest.push(tok);
  }

  out.text = rest.join(" ");
  return out;
}

/** ¿Hay algo más que texto? (si no, la búsqueda normal basta). */
export const hasSyntax = (p: ParsedQuery) => p.chips.length > 0;
