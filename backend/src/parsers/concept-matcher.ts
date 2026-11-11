export interface ParsedConcept {
  category: "devengo" | "deduccion" | "otros";
  name: string;
  amount: number;
  isPercentage: boolean;
}

export interface ParsedPayslip {
  periodMonth: number | null;
  periodYear: number | null;
  company: string | null;
  grossSalary: number | null;
  netSalary: number | null;
  concepts: ParsedConcept[];
  rawText: string;
  /** Formato con el que se leyó (id de `formats/`); lo pone `matchConcepts`. */
  format?: string;
  /** Milisegundos de extracción y análisis (solo al subir el PDF). */
  parseMs?: number;
}

// ─── Number parsing ─────────────────────────────────────────────

/**
 * Parse Spanish number format: "1.234,56" → 1234.56
 *
 * Sustituye letras que el OCR de la versión antigua (retirada, ver AGENTS.md
 * raíz) solía confundir con dígitos — algunos tests siguen usando esas
 * nóminas degradadas como fixture de regresión. NO incluye "€": a
 * diferencia de esas letras, el símbolo de euro SÍ aparece pegado a
 * importes reales en texto limpio de pdfjs (p. ej. "1.234,56€" sin
 * espacio) — tratarlo como un dígito más multiplicaba el importe por 10
 * (p. ej. "€1.234,56" se leía como 81234,56). Ver findAllAmounts: € ya no
 * forma parte de la clase de caracteres que compone un importe, así que
 * nunca llega a colarse en el grupo capturado.
 */
function normalizeOcrNumericText(str: string): string {
  return str.replace(/[OQDCcoIlSBEbse\|]/g, (char) => {
    switch (char) {
      case "O":
      case "Q":
      case "D":
      case "C":
      case "c":
      case "o":
        return "0";
      case "I":
      case "l":
      case "|":
        return "1";
      case "S":
      case "s":
        return "5";
      case "B":
      case "E":
      case "b":
      case "e":
        return "8";
      default:
        return char;
    }
  });
}

function parseSpanishNumber(str: string): number | null {
  const cleaned = normalizeOcrNumericText(str)
    .replace(/\s/g, "")
    .replace(/\.(\d{3})/g, "$1") // Remove thousands dots (1.234 → 1234)
    .replace(",", ".");           // Decimal comma → dot
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

/** Find ALL Spanish-format amounts in a string */
function findAllAmounts(text: string): number[] {
  const re = /([0-9OQDCIEBSloqdciebs]{1,3}(?:\.[0-9OQDCIEBSloqdciebs]{3})*,[0-9OQDCIEBSloqdciebs]{2})/g;
  const results: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseSpanishNumber(m[1]);
    if (v !== null) results.push(v);
  }
  return results;
}

/** Extract the LAST amount from a text (the rightmost number) */
function extractLastAmount(text: string): number | null {
  const amounts = findAllAmounts(text);
  return amounts.length > 0 ? amounts[amounts.length - 1] : null;
}

// ─── Pre-processing: rejoin numbers split across lines ──────────

/**
 * pdf-parse often breaks lines in the middle of numbers.
 * Example: "1.869,3\n3" should be "1.869,33"
 * Example: "2.299\n,11" should be "2.299,11"
 */
function rejoinSplitNumbers(text: string): string {
  // Join: line ends with partial decimal (digit after comma, less than 2 digits)
  // Next line starts with 1-2 digits
  // e.g., "1.869,3\n3" → "1.869,33"  or  "1.869,\n33" → "1.869,33"
  text = text.replace(
    /(\d),(\d)?\s*\n\s*(\d{1,2})\b/g,
    (_, pre, mid, post) => mid ? `${pre},${mid}${post}` : `${pre},${post}`
  );

  // Join: line ends with digits (no comma yet), next line starts with ,\d{2}
  // e.g., "2.299\n,11" → "2.299,11"
  text = text.replace(
    /(\d)\s*\n\s*,(\d{2})\b/g,
    "$1,$2"
  );

  // Join: line ends with dot+digits (thousands), next line starts with digits
  // e.g., "3.628,1\n2" → "3.628,12"
  text = text.replace(
    /(\d),(\d)\s*\n\s*(\d)\b/g,
    "$1,$2$3"
  );

  return text;
}

// ─── Concept patterns ───────────────────────────────────────────

/** Combined name patterns — used for labeling only, not classification */
const NAME_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  // Devengos
  { regex: /salario\s*base/i, name: "Salario Base" },
  { regex: /sueldo\s*base/i, name: "Salario Base" },
  { regex: /complemento\s*destino/i, name: "Complemento de Destino" },
  { regex: /C\.\s*DESTINO/i, name: "Complemento de Destino" },
  { regex: /complemento\s*(?:personal|puesto|espec[ií]fico)/i, name: "Complemento" },
  { regex: /plus\s*(?:convenio|transporte|actividad|nocturnidad|peligrosidad|turnicidad)/i, name: "Plus Convenio" },
  { regex: /antig[üu]edad/i, name: "Antigüedad" },
  { regex: /trienio/i, name: "Trienios" },
  { regex: /horas?\s*extra/i, name: "Horas Extra" },
  { regex: /paga\s*extra/i, name: "Paga Extra" },
  { regex: /gratificaci[oó]n/i, name: "Gratificación" },
  { regex: /incentivo/i, name: "Incentivo" },
  { regex: /bonus|[fp]rima\b|frima\b/i, name: "Bonus/Prima" },
  { regex: /dieta/i, name: "Dietas" },
  { regex: /locomoci[oó]n|km|kil[oó]metro/i, name: "Locomoción/Transporte" },
  { regex: /mejora\s*(?:voluntaria|absorbible)/i, name: "Mejora Voluntaria" },
  { regex: /retribuci[oó]n\s*flexible/i, name: "Retribución Flexible" },
  { regex: /complemento\s*(?:de\s*)?convenio/i, name: "Complemento Convenio" },
  { regex: /(?:p|f)arte\s+pro[fp]\.?p(?:agas|ag)/i, name: "Parte Proporcional Pagas" },
  { regex: /vacaciones/i, name: "Vacaciones" },
  { regex: /productividad/i, name: "Productividad" },
  { regex: /poliza\s*seg(?:uro)?\s*salud/i, name: "Póliza Seguro Salud" },
  { regex: /poliza\s*seg(?:uro)?\s*vida/i, name: "Póliza Seguro Vida" },
  { regex: /abono\s*trabajador/i, name: "Abono Trabajador" },
  { regex: /abono\s*catering/i, name: "Abono Catering" },
  { regex: /catering/i, name: "Catering" },
  // Type 2 specific devengos
  { regex: /C\.?P\.?\s*TRANSITORIO?/i, name: "Complemento Transitorio" },
  { regex: /COMP\.?\s*GEN\.?\s*ESP|C\.?GRAL\.?\s*C\.?\s*ESP/i, name: "Complemento General Específico" },
  { regex: /COMP\.?\s*SING|C\.?SING\.?\s*C\.?\s*ESPE/i, name: "Complemento Singular Específico" },
  { regex: /COMP\.?\s*PRESTACIONES\s*IT/i, name: "Complemento Prestaciones IT" },
  { regex: /PRESTACIONES\s*IT/i, name: "Prestaciones IT" },
  { regex: /i\.?\s*r\.?\s*p\.?\s*f\.?\s*en\s*it/i, name: "IRPF en IT" },
  // Deducciones
  { regex: /seguridad\s*social/i, name: "Contingencias Comunes" },
  { regex: /cotizaci[oó]n\s*cont\.?\s*(?:ingencias?)?\s*comu/i, name: "Contingencias Comunes" },
  { regex: /contingencias?\s*comunes?/i, name: "Contingencias Comunes" },
  { regex: /cotizaci[oó]n\s*desemple\w*/i, name: "Desempleo" },
  { regex: /cotizaci[oó]n\s*formaci[oó]n/i, name: "Formación Profesional" },
  { regex: /form\.?\s*profesional/i, name: "Formación Profesional" },
  { regex: /cotizaci[oó]n\s*MEI|MEI\b/i, name: "MEI" },
  { regex: /mec\s*equidad/i, name: "MEI" },
  { regex: /tributaci[oó]n\s*i\.?\s*r\.?\s*p\.?\s*f/i, name: "IRPF" },
  { regex: /^I\.?\s*R\.?\s*P\.?\s*F\.?$/i, name: "IRPF" },
  { regex: /i\.?\s*r\.?\s*p\.?\s*f\.?\s*\d/i, name: "IRPF" },
  { regex: /retenci[oó]n(?:es)?\s*(?:a\s*cuenta|irpf|fiscal)/i, name: "IRPF" },
  { regex: /desemple\w*/i, name: "Desempleo" },
  { regex: /anticipo/i, name: "Anticipo" },
  { regex: /embargo/i, name: "Embargo" },
  { regex: /pr[eé]stamo/i, name: "Préstamo" },
  { regex: /sindicat/i, name: "Cuota Sindical" },
  { regex: /seguro\s*m[eé]dico/i, name: "Seguro Médico" },
  { regex: /plan\s*(?:de\s*)?pensiones/i, name: "Plan de Pensiones" },
  { regex: /devol(?:uci[oó]n)?\s*poliza/i, name: "Devolución Póliza" },
  { regex: /d(?:cto|eto|ceto)[\.\s]*concept\w*/i, name: "Descuento Conceptos en Especie" },
  { regex: /imp[\.\s]*ingr/i, name: "Ingreso a Cuenta Especie" },  // Type 2 specific deducciones
  { regex: /ATR\.?\s*IRPF/i, name: "Atraso IRPF" },];

const TYPE1_DEDUCTION_NAMES = new Set([
  "Contingencias Comunes",
  "Desempleo",
  "Formación Profesional",
  "IRPF",
  "IRPF en IT",
  "MEI",
  "Atraso IRPF",
  "Anticipo",
  "Embargo",
  "Préstamo",
  "Cuota Sindical",
  "Seguro Médico",
  "Plan de Pensiones",
  "Devolución Póliza",
  "Descuento Conceptos en Especie",
  "Ingreso a Cuenta Especie",
]);

const TYPE1_RATE_BASED_DEDUCTIONS = new Set([
  "Contingencias Comunes",
  "Desempleo",
  "Formación Profesional",
  "MEI",
]);

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Text preprocessing ─────────────────────────────────────────

/** Strip box-drawing characters used in public-sector payslip tables */
function stripBoxDrawingChars(text: string): string {
  return text.replace(/[│├┤┌┐└┘┬┴┼─═║╔╗╚╝╠╣╦╩╬]/g, " ");
}

// ─── Payslip format detection ───────────────────────────────────

type PayslipFormat = "type1" | "type2";

/** Cabecera típica de las notificaciones de retribuciones de la Administración (type2). */
export function looksLikePublicSectorPayslip(text: string): boolean {
  return /NOTIFICACION\s+DE\s+RETRIBUCIONES/i.test(text) || /NOMINA\s+MENSUAL\s*,/i.test(text);
}

function detectFormat(text: string): PayslipFormat {
  return looksLikePublicSectorPayslip(text) ? "type2" : "type1";
}

// ─── Type 2 deduction name matching ─────────────────────────────

const TYPE2_DEDUCTION_PREFIXES = [
  "SEGURIDAD SOCIAL",
  "DESEMPLEO",
  "FORM. PROFESIONAL",
  "FORMACION PROFESIONAL",
  "MEC EQUIDAD",
  "I.R.P.F",
  "IRPF",
  "ATR. IRPF",
  "ATR IRPF",
  "TRIBUTACION",
];

function isType2DeductionName(name: string): boolean {
  const upper = name.toUpperCase().replace(/[−\-]/g, " ").trim();
  return TYPE2_DEDUCTION_PREFIXES.some((p) => upper.startsWith(p));
}

// ─── Period extraction ──────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

function resolveMonth(s: string): number | null {
  const low = s.toLowerCase().replace(/\./g, "");
  if (MONTH_NAMES[low]) return MONTH_NAMES[low];
  // Partial match for OCR issues
  for (const [key, val] of Object.entries(MONTH_NAMES)) {
    if (key.length >= 3 && low.startsWith(key)) return val;
  }
  return null;
}

function resolveYear(s: string): number | null {
  const n = parseInt(s, 10);
  if (isNaN(n)) return null;
  // 2-digit year
  if (n >= 0 && n <= 99) return n < 50 ? 2000 + n : 1900 + n;
  if (n >= 1990 && n <= 2100) return n;
  return null;
}

function extractPeriod(text: string): { month: number | null; year: number | null } {
  // 0) Type 2: "NOMINA MENSUAL, NOVIEMBRE" + "Del DD/MM/YYYY al DD/MM/YYYY"
  const nomlPattern = /NOMINA\s+MENSUAL\s*,\s*([A-ZÀ-ÿ]+)/i;
  const nomlMatch = text.match(nomlPattern);
  if (nomlMatch) {
    const month = resolveMonth(nomlMatch[1]);
    if (month) {
      const delPattern = /Del\s+\d{1,2}\/\d{1,2}\/(\d{4})\s+al\s+\d{1,2}\/\d{1,2}\/(\d{4})/i;
      const delMatch = text.match(delPattern);
      if (delMatch) {
        const year = resolveYear(delMatch[2]) ?? resolveYear(delMatch[1]);
        if (year) return { month, year };
      }
      // Try year from any 4-digit number near the month name
      const yearNear = text.match(new RegExp(nomlMatch[0] + "[\\s\\S]{0,100}?(\\d{4})", "i"));
      if (yearNear) {
        const year = resolveYear(yearNear[1]);
        if (year) return { month, year };
      }
    }
  }

  // 1) "MENS DD MON YY a DD MON YY" — payroll software period line
  const mensPattern = /MENS\s+\d{1,2}\s+(\w{3,})\s+(\d{2,4})\s+a\s+\d{1,2}\s+(\w{3,})\s+(\d{2,4})/i;
  const mensMatch = text.match(mensPattern);
  if (mensMatch) {
    const month = resolveMonth(mensMatch[3]) ?? resolveMonth(mensMatch[1]);
    const year = resolveYear(mensMatch[4]) ?? resolveYear(mensMatch[2]);
    if (month && year) return { month, year };
  }

  // 2) "P.EXTRA:... DD MON YYYY" — extra pay
  const pextraPattern = /P\.?\s*EXTRA[^\n]*?(\d{1,2})\s+(\w{3,})\s+(\d{2,4})/i;
  const pextraMatch = text.match(pextraPattern);
  if (pextraMatch) {
    const month = resolveMonth(pextraMatch[2]);
    const year = resolveYear(pextraMatch[3]);
    if (month && year) return { month, year };
  }

  // 3) "FECHA ... D MONTH YYYY" — receipt date line
  const fechaPattern = /FECHA[\s\S]{0,100}?(\d{1,2})\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(\d{4})/i;
  const fechaMatch = text.match(fechaPattern);
  if (fechaMatch) {
    const month = resolveMonth(fechaMatch[2]);
    const year = resolveYear(fechaMatch[3]);
    if (month && year) return { month, year };
  }

  // 4) "Periodo de liquidación: MONTH YYYY" or "Periodo: MM-YYYY"
  const periodoPattern = /per[ií]odo(?:\s*de\s*liquidaci[oó]n)?[:\s]+(\w+)[\s\-\/]+(\d{2,4})/i;
  const periodoMatch = text.match(periodoPattern);
  if (periodoMatch) {
    const month = resolveMonth(periodoMatch[1]) ?? (parseInt(periodoMatch[1]) >= 1 && parseInt(periodoMatch[1]) <= 12 ? parseInt(periodoMatch[1]) : null);
    const year = resolveYear(periodoMatch[2]);
    if (month && year) return { month, year };
  }

  // 5) Generic "MonthName YYYY" or "MonthName de YYYY"
  const genericPattern = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/i;
  const genericMatch = text.match(genericPattern);
  if (genericMatch) {
    const month = resolveMonth(genericMatch[1]);
    const year = resolveYear(genericMatch[2]);
    if (month && year) return { month, year };
  }

  // 6) Numeric patterns: DD/MM/YYYY, MM-YYYY, MM/YYYY
  const numericPatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,  // DD/MM/YYYY
    /(\d{1,2})[\/\-](\d{4})/,                   // MM/YYYY or MM-YYYY
  ];
  for (const pat of numericPatterns) {
    const m = text.match(pat);
    if (m) {
      if (m[3]) {
        // DD/MM/YYYY
        const month = parseInt(m[2]);
        const year = parseInt(m[3]);
        if (month >= 1 && month <= 12 && year >= 1990 && year <= 2100) return { month, year };
      } else {
        // MM/YYYY
        const month = parseInt(m[1]);
        const year = parseInt(m[2]);
        if (month >= 1 && month <= 12 && year >= 1990 && year <= 2100) return { month, year };
      }
    }
  }

  return { month: null, year: null };
}

// ─── Company extraction ─────────────────────────────────────────

function extractCompany(text: string): string | null {
  // Type 2 public-sector payslips have no company name — skip expensive patterns
  if (detectFormat(text) === "type2") return null;

  // Pattern 1: Line after "NIF." containing company name (common payroll software)
  const nifBlock = /NIF\.?\s*[A-Z]?\d{7,8}[A-Z]?[\s\S]{0,200}?\n\s*\[?([A-Z][A-Z0-9 ,\.]{1,58}\s(?:SL|SA|SLU|SAU|SLL|COOP|SCL))\b/i;
  const nifMatch = text.match(nifBlock);
  if (nifMatch) return nifMatch[1].trim();

  // Pattern 2: Explicit "Empresa:" / "Razón Social:" label
  const labelPatterns = [
    /(?:empresa|raz[oó]n\s*social|denominaci[oó]n)[:\s]+([^\n]{3,80})/i,
  ];
  for (const pat of labelPatterns) {
    const m = text.match(pat);
    if (m) {
      const company = m[1].trim().split(/\s{3,}/)[0].trim();
      if (
        company.length > 2
        && company.length < 100
        && /[A-Za-zÀ-ÿ]/.test(company)
        && !/\bRECIBI\b/i.test(company)
        && !/^(?:FECHA\s+SELLO\s+EMPRESA|COSTE\s+EMPRESA)\b/i.test(company)
      ) {
        return company;
      }
    }
  }

  // Pattern 3: Look for "SL", "SA" etc. on a line by itself or with a name
  const slPattern = /^\s*\[?([A-Z][A-Z0-9 ,\.]{1,58}\s(?:SL|SA|SLU|SAU|SLL)\b)/m;
  const slMatch = text.match(slPattern);
  if (slMatch) return slMatch[1].trim();

  return null;
}

function sanitizeCompanyCandidate(company: string | null): string | null {
  if (!company) return null;

  const normalized = company.replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || normalized.length > 100) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return null;
  if (/\b(?:RECIBI|FECHA|SELLO|COSTE|LIQUIDO|PERCIBIR)\b/i.test(normalized)) return null;

  return normalized;
}

// ─── Concept line detection ─────────────────────────────────────

/**
 * Detect if a line is a payslip concept line.
 * Spanish payroll lines typically look like:
 *   [days]  [price]  code  [*]name  amount
 * Code is a numeric 1-3 digit number. Names often start with *.
 */
function isConceptLine(line: string): boolean {
  // Must contain at least one amount
  if (findAllAmounts(line).length === 0) return false;
  // Standard code + text, allowing OCR-inserted separators
  if (/(?:^|[^\d])\d{1,3}\s*\|?\s*\*?\s*[A-Za-zÀ-ÿ]/.test(line)) return true;
  // Some OCR outputs preserve the asterisk marker but mangle the code column
  if (/\*\s*[A-Za-zÀ-ÿ]/.test(line)) return true;
  // APG OCR often loses the header but keeps recognizable concept words
  if (/(salario|convenio|absorbible|poliza|catering|abono|d(?:cto|eto|ceto)|concept|cotizaci[oó]n|tributaci[oó]n|irpf)/i.test(line)) return true;
  return false;
}

function isType1ConceptHeader(line: string): boolean {
  return /CONCEPTO\s*DEVENGOS\s*DEDUCCIONES/i.test(line)
    || /(?:CANT|CUANT).*(?:PREC|PRE[Cc]O).*(?:DEVEN|PEVENC).*(?:DEDUC|NENCCO)/i.test(line);
}

function isType1NetLabel(line: string): boolean {
  return /L[IÍ]Q[UÜ]I?D[O0]\s*A\s*PERCI?BIR/i.test(line);
}

function isType1FooterLine(line: string): boolean {
  return isType1NetLabel(line)
    || /\bIBAN\b/i.test(line)
    || /\bSWIFT\/?BIC\b/i.test(line)
    || /COSTE\s*EMPRESA/i.test(line)
    || /CONCEPTO\s+BASE\s+TIPO/i.test(line)
    || /DETERMINACI[OÓ]N\s*(?:DE\s*)?(?:LAS?\s*)?B/i.test(line);
}

function extractType1ConceptCode(line: string): number {
  const codeBeforeMarker = line.match(/(?:^|\s)(\d{1,3})\s*\|?\s*\*\s*[A-Za-zÀ-ÿ]/);
  if (codeBeforeMarker) return parseInt(codeBeforeMarker[1], 10);

  const leadingCode = line.match(/^\s*(\d{1,3})\s*\|?\s*\*?\s*[A-Za-zÀ-ÿ]/);
  if (leadingCode) return parseInt(leadingCode[1], 10);

  const inlineCode = line.match(/(?:^|\s)(\d{1,3})\s*\|?\s*\*?\s*[A-Za-zÀ-ÿ]/);
  if (inlineCode) return parseInt(inlineCode[1], 10);

  return -1;
}

function isType1DeductionName(name: string): boolean {
  return TYPE1_DEDUCTION_NAMES.has(name);
}

function extractType1ContributionBase(text: string): number | null {
  for (const line of text.split("\n")) {
    if (!/contingencias?\s+comunes?/i.test(line)) continue;
    const amounts = findAllAmounts(line);
    if (amounts.length >= 3) {
      return amounts[0];
    }
  }

  return null;
}

function recoverType1PostFooterDeductions(
  lines: string[],
  concepts: ParsedConcept[],
  deductionRates: Map<string, number>,
): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const code = extractType1ConceptCode(trimmed);
    if (code < 995 || code > 999) continue;

    const amounts = findAllAmounts(trimmed);
    const lastAmount = amounts.length > 0 ? amounts[amounts.length - 1] : null;
    if (lastAmount === null || lastAmount <= 0) continue;

    let conceptName: string | null = null;
    for (const { regex, name } of NAME_PATTERNS) {
      if (regex.test(trimmed)) {
        conceptName = name;
        break;
      }
    }

    if (!conceptName || !isType1DeductionName(conceptName)) continue;

    if (amounts.length >= 2) {
      const rateCandidate = amounts[0];
      if (rateCandidate > 0 && rateCandidate <= 50) {
        deductionRates.set(conceptName, rateCandidate);
      }
    }

    if (!concepts.some((concept) => concept.category === "deduccion" && concept.name === conceptName)) {
      concepts.push({ category: "deduccion", name: conceptName, amount: lastAmount, isPercentage: false });
    }
  }
}

// ─── Payslip type detection ─────────────────────────────────────

/**
 * Patterns that indicate the payslip IS a paga extra (not just a concept line).
 * We look for header-level indicators and exclude concept-line false positives
 * like "PRORRATA PAGA EXTRA" or "P. EXTRA JUNIO" which appear in regular payslips.
 */
const EXTRA_TITLE_PATTERNS = [
  /gratificaci[oó]n\s*(extra|extraordinaria)/i,
  /n[oó]mina\s+(de\s+)?paga\s*extra/i,
  /tipo\s*de\s*n[oó]mina\s*:?\s*extra/i,
];

/** Concept-line patterns that should NOT trigger detection on their own */
const EXTRA_CONCEPT_EXCLUSIONS = [
  /prorrat/i,         // "PRORRATA PAGA EXTRA"
  /^\s*\d{1,3}\s+/,  // line starting with a concept code number
  /p\.?\s*p\.?\s*extras?/i,
  /rem\.\s*total/i,
];

export function detectPayslipType(rawText: string): "ordinal" | "extra" {
  // Strong title-level match → always extra
  if (EXTRA_TITLE_PATTERNS.some((re) => re.test(rawText))) return "extra";

  // Check each line containing "paga extra" or "P. EXTRA"
  const weakPattern = /paga\s*extra|P\.?\s*EXTRA/i;
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    if (!weakPattern.test(line)) continue;
    // Skip if it looks like a concept line (prorated, or starts with code number)
    if (EXTRA_CONCEPT_EXCLUSIONS.some((re) => re.test(line))) continue;
    return "extra";
  }

  return "ordinal";
}

// El reparto entre formatos (qué analizador se usa para cada texto) está en
// formats/index.ts (`matchConcepts`); aquí quedan los dos analizadores.

// ─── Type 1 parser (private company) ────────────────────────────

export function matchConceptsType1(rawText: string): ParsedPayslip {
  // Step 1: Rejoin numbers split across line breaks and strip OCR pipe chars (table borders)
  const text = rejoinSplitNumbers(rawText.replace(/\r\n/g, "\n")).replace(/\|/g, " ");
  const lines = text.split("\n");

  const concepts: ParsedConcept[] = [];
  let grossSalary: number | null = null;
  let netSalary: number | null = null;
  let totalDeductions: number | null = null;
  let inConceptsSection = false;
  let reachedTotalsSection = false;
  const deductionRates = new Map<string, number>();

  // Detect concepts section by looking for the header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect start of concepts section
    if (isType1ConceptHeader(trimmed)) {
      inConceptsSection = true;
      continue;
    }

    // Auto-detect concept section start: line with code + asterisk + name + amount
    // This catches OCR-mangled headers where "CONCEPTO DEVENGOS DEDUCCIONES" is unreadable
    if (!inConceptsSection && /\b\d{1,3}\s+\*\s*[A-Za-z\xC0-\xFF]/.test(trimmed) && /\d{1,3}(?:\.\d{3})*,\d{2}/.test(trimmed)) {
      inConceptsSection = true;
      // Don't continue — this line itself is a concept to parse
    }

    // Detect end of concepts section (totals row)
    if (
      /T[.\-]\s*DEVENGADO/i.test(trimmed)
      || /BASE\s*S\.?\s*S\.?/i.test(trimmed)
      || isType1FooterLine(trimmed)
    ) {
      inConceptsSection = false;
      reachedTotalsSection = true;
    }

    // ─── Parse concept lines ──────────────────────────────────
    const looksLikeConcept = isConceptLine(trimmed);

    if (!reachedTotalsSection && (inConceptsSection || looksLikeConcept)) {
      if (!looksLikeConcept) continue;

      const amounts = findAllAmounts(trimmed);
      const lastAmount = amounts.length > 0 ? amounts[amounts.length - 1] : null;

      if (lastAmount !== null && lastAmount > 0) {
        // Extract concept code (1-3 digit number before the concept name)
        const code = extractType1ConceptCode(trimmed);

        // Try to match a friendly name from NAME_PATTERNS
        let conceptName: string | null = null;
        for (const { regex, name } of NAME_PATTERNS) {
          if (regex.test(trimmed)) {
            conceptName = name;
            break;
          }
        }

        // Fallback: extract raw concept name from line
        if (!conceptName) {
          const nameMatch = trimmed.match(/\d\s+\*?\s*([A-Za-zÀ-ÿ][\wÀ-ÿ\s\.\-()]{2,45})/);
          conceptName = nameMatch
            ? nameMatch[1].replace(/\s+/g, " ").replace(/\s*\d+[,\.]\d+\s*$/, "").trim()
            : `Concepto ${code}`;
        }

        // Determine category: 700+ = deduccion, except known devengo names
        const DEVENGO_NAMES = ["Paga Extra", "Gratificación", "Bonus/Prima"];
        let category: "devengo" | "deduccion";
        if (DEVENGO_NAMES.includes(conceptName)) {
          category = "devengo";
        } else if (isType1DeductionName(conceptName)) {
          category = "deduccion";
        } else {
          category = code >= 700 ? "deduccion" : "devengo";
        }

        if (category === "deduccion" && amounts.length >= 2) {
          const rateCandidate = amounts[0];
          if (rateCandidate > 0 && rateCandidate <= 50) {
            deductionRates.set(conceptName, rateCandidate);
          }
        }

        if (!concepts.some((c) => c.name === conceptName && c.amount === lastAmount)) {
          concepts.push({ category, name: conceptName, amount: lastAmount, isPercentage: false });
        }
      }
    }

    // ─── Extract totals ──────────────────────────────────────
    // "LIQUIDO A PERCIBIR" — net salary (most reliable, extract first)
    if (isType1NetLabel(trimmed)) {
      const searchBlock = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      const blockAmounts = findAllAmounts(searchBlock);
      if (blockAmounts.length > 0) {
        netSalary = blockAmounts[0];
      }
    }

    // "T. DEVENGADO" / "T. A DEDUCIR" row — summary totals
    if (/T\.\s*DEVENGADO/i.test(trimmed) || /T\.\s*A\s*DEDUCIR/i.test(trimmed)) {
      const searchBlock = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      const blockAmounts = findAllAmounts(searchBlock);
      if (blockAmounts.length > 0) {
        // T. A DEDUCIR is always the last value in this row
        totalDeductions = blockAmounts[blockAmounts.length - 1];

        // T. DEVENGADO: verify using net + deductions = gross
        // Try each amount to find the one that satisfies: amount - totalDeductions ≈ netSalary
        if (netSalary !== null && totalDeductions !== null) {
          for (const amt of blockAmounts) {
            if (Math.abs(amt - totalDeductions - netSalary) < 1) {
              grossSalary = amt;
              break;
            }
          }
        }

        // Fallback: second-to-last amount is likely T. DEVENGADO
        if (grossSalary === null && blockAmounts.length >= 2) {
          grossSalary = blockAmounts[blockAmounts.length - 2];
        }
      }
    }

    // Alternative net patterns
    if (!netSalary && /(?:neto\s*a\s*percibir|total\s*neto|importe\s*l[ií]quido)/i.test(trimmed)) {
      const amt = extractLastAmount(trimmed);
      if (amt !== null) netSalary = amt;
    }

    // Alternative gross patterns
    if (!grossSalary && /total\s*(?:devengado|devengos|percepciones|haberes|bruto)/i.test(trimmed)) {
      const amt = extractLastAmount(trimmed);
      if (amt !== null) grossSalary = amt;
    }

    // "T. A DEDUCIR"
    if (!totalDeductions && /T\.\s*A\s*DEDUCIR/i.test(trimmed)) {
      const searchBlock = lines.slice(i, Math.min(i + 3, lines.length)).join(" ");
      const blockAmounts = findAllAmounts(searchBlock);
      if (blockAmounts.length > 0) {
        totalDeductions = blockAmounts[blockAmounts.length - 1];
      }
    }
  }

  recoverType1PostFooterDeductions(lines, concepts, deductionRates);

  // ─── Fallback pass: NAME_PATTERNS matching when section detection failed ──
  if (concepts.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;

      // Stop at bottom sections
      if (/DETERMINACI[O\xD3]N|CONCEPTO\s+BASE\s+TIPO/i.test(trimmed)) break;
      if (/IBAN|SWIFT|COSTE\s*EMPRESA/i.test(trimmed)) continue;
      if (/LIQUIDO\s*A\s*PERCIBIR/i.test(trimmed)) continue;

      if (!/\d{1,3}(?:\.\d{3})*,\d{2}/.test(trimmed)) continue;

      // Must match a known concept name
      let matchedName: string | null = null;
      for (const { regex, name } of NAME_PATTERNS) {
        if (regex.test(trimmed)) {
          matchedName = name;
          break;
        }
      }
      if (!matchedName) continue;

      const amounts = findAllAmounts(trimmed);
      const lastAmount = amounts.length > 0 ? amounts[amounts.length - 1] : null;
      if (lastAmount === null || lastAmount <= 0) continue;

      const code = extractType1ConceptCode(trimmed);

      const DEVENGO_NAMES = ["Paga Extra", "Gratificación", "Bonus/Prima"];
      const category: "devengo" | "deduccion" = DEVENGO_NAMES.includes(matchedName)
        ? "devengo"
        : isType1DeductionName(matchedName) || code >= 700 ? "deduccion" : "devengo";

      if (category === "deduccion" && amounts.length >= 2) {
        const rateCandidate = amounts[0];
        if (rateCandidate > 0 && rateCandidate <= 50) {
          deductionRates.set(matchedName, rateCandidate);
        }
      }

      if (!concepts.some((c) => c.name === matchedName && c.amount === lastAmount)) {
        concepts.push({ category, name: matchedName, amount: lastAmount, isPercentage: false });
      }
    }
  }

  const period = extractPeriod(text);
  const company = sanitizeCompanyCandidate(extractCompany(text));

  // ─── Fallbacks ──────────────────────────────────────────────

  // If we found gross from the totals row, use it.
  // If not, compute from concepts.
  if (grossSalary === null && concepts.length > 0) {
    const devengos = concepts.filter((c) => c.category === "devengo");
    if (devengos.length > 0) {
      grossSalary = roundCurrency(devengos.reduce((s, c) => s + c.amount, 0));
    }
  }

  const contributionBase = extractType1ContributionBase(text);
  if (contributionBase !== null) {
    for (const concept of concepts) {
      if (!TYPE1_RATE_BASED_DEDUCTIONS.has(concept.name)) continue;

      const rate = deductionRates.get(concept.name);
      if (rate === undefined) continue;

      const expectedAmount = roundCurrency((contributionBase * rate) / 100);
      if (Math.abs(expectedAmount - concept.amount) <= 0.05) {
        concept.amount = expectedAmount;
      }
    }

    const currentDevengos = concepts.filter((concept) => concept.category === "devengo");
    const currentGross = roundCurrency(currentDevengos.reduce((sum, concept) => sum + concept.amount, 0));
    const grossDiff = roundCurrency(contributionBase - currentGross);

    if (
      grossSalary === null
      || Math.abs(grossSalary - contributionBase) <= 1
      || Math.abs(grossDiff) <= 1
    ) {
      grossSalary = contributionBase;
    }

    if (Math.abs(grossDiff) > 0 && Math.abs(grossDiff) <= 0.5) {
      const salaryBaseConcept = concepts.find((concept) => concept.category === "devengo" && concept.name === "Salario Base");
      if (salaryBaseConcept) {
        salaryBaseConcept.amount = roundCurrency(salaryBaseConcept.amount + grossDiff);
      }
    }
  }

  // Net = check LIQUIDO first, then gross - deductions
  if (netSalary === null && grossSalary !== null && totalDeductions !== null) {
    netSalary = roundCurrency(grossSalary - totalDeductions);
  }
  if (netSalary === null && grossSalary !== null && concepts.length > 0) {
    const deducciones = concepts.filter((c) => c.category === "deduccion");
    if (deducciones.length > 0) {
      netSalary = roundCurrency(grossSalary - deducciones.reduce((s, c) => s + c.amount, 0));
    } else {
      netSalary = grossSalary;
    }
  }

  return {
    periodMonth: period.month,
    periodYear: period.year,
    company,
    grossSalary,
    netSalary,
    concepts,
    rawText,
  };
}

// ─── Type 2 parser (public sector) ──────────────────────────────

/** Resolve a friendly concept name from NAME_PATTERNS, or title-case as fallback */
function resolveConceptName(raw: string): string {
  for (const { regex, name } of NAME_PATTERNS) {
    if (regex.test(raw)) return name;
  }
  return raw
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parse a single reconstructed concept line from a Type 2 payslip.
 * Pushes extracted concepts into the `concepts` array.
 */
function parseConceptLineType2(line: string, concepts: ParsedConcept[]): void {
  const amounts = findAllAmounts(line);
  if (amounts.length === 0) return;

  const hasPeriodPrefix = /^\d\s/.test(line);

  // ── Extract concept name ─────────────────────────────────
  let nameStr = line;
  if (hasPeriodPrefix) nameStr = nameStr.replace(/^\d\s+/, "");
  // Extract and strip AT.XXX.YY suffix (atrasos)
  let atSuffix = "";
  const atMatch = nameStr.match(/\s+AT\.(\w{3}\.\d{2})/i);
  if (atMatch) {
    atSuffix = ` (Atraso ${atMatch[1]})`;
    nameStr = nameStr.replace(/\s+AT\.\w{3}\.\d{2}/i, "");
  }
  // Remove amounts and %
  nameStr = nameStr
    .replace(/\d{1,3}(?:\.\d{3})*,\d{2}/g, "")
    .replace(/%/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!nameStr || nameStr.length < 2) return;

  // ── Classify ─────────────────────────────────────────────
  const isExtra = /EXTRA\s*[−\-]/i.test(nameStr);
  const isDeduction = isType2DeductionName(nameStr);

  // In type 2 payslips, earlier numeric cells are usually quantity/base/price.
  // The rightmost monetary cell is the actual amount to persist.
  const amount = amounts[amounts.length - 1];
  const category: "devengo" | "deduccion" = isDeduction ? "deduccion" : "devengo";

  // ── Resolve friendly name ────────────────────────────────
  let conceptName: string;
  if (isExtra) {
    const baseName = nameStr.replace(/EXTRA\s*[−\-]\s*/i, "").trim();
    conceptName = "Paga Extra - " + resolveConceptName(baseName);
  } else {
    conceptName = resolveConceptName(nameStr);
  }
  conceptName += atSuffix;

  if (amount > 0 && !concepts.some((c) => c.name === conceptName && c.amount === amount)) {
    concepts.push({ category, name: conceptName, amount, isPercentage: false });
  }
}

function sumConceptAmounts(concepts: ParsedConcept[], category: ParsedConcept["category"]): number {
  return Math.round(
    concepts
      .filter((concept) => concept.category === category)
      .reduce((sum, concept) => sum + concept.amount, 0) * 100,
  ) / 100;
}

function extractType2SummaryTotals(
  lines: string[],
  netSalary: number | null,
): { grossSalary: number | null; totalDeductions: number | null } {
  for (let index = 0; index < lines.length; index += 1) {
    const stripped = lines[index].replace(/│/g, " ").trim();
    if (!/Remuneraci[oó]n/i.test(stripped) || !/Devengado/i.test(stripped) || !/Deducciones/i.test(stripped)) {
      continue;
    }

    const searchBlock = lines
      .slice(index, Math.min(index + 6, lines.length))
      .map((candidate) => candidate.replace(/│/g, " ").replace(/\s+/g, " ").trim())
      .join(" ");
    const amounts = findAllAmounts(searchBlock);

    if (amounts.length === 0) {
      continue;
    }

    if (netSalary !== null) {
      for (const grossCandidate of amounts) {
        for (const deductionCandidate of amounts) {
          if (grossCandidate <= deductionCandidate) continue;
          if (Math.abs(grossCandidate - deductionCandidate - netSalary) < 1) {
            return { grossSalary: grossCandidate, totalDeductions: deductionCandidate };
          }
        }
      }
    }

    const sorted = [...amounts].sort((left, right) => right - left);
    return {
      grossSalary: sorted[0] ?? null,
      totalDeductions: sorted[1] ?? null,
    };
  }

  return { grossSalary: null, totalDeductions: null };
}

export function matchConceptsType2(rawText: string): ParsedPayslip {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const concepts: ParsedConcept[] = [];
  let grossSalary: number | null = null;
  let netSalary: number | null = null;
  let totalDeductions: number | null = null;

  // El extractor posicional ya entrega una fila lógica por línea (agrupada
  // por coordenada Y), así que cada línea de la sección de conceptos se
  // parsea directamente — no hace falta reconstruir celdas fragmentadas.
  let inConcepts = false;

  for (const line of lines) {
    const stripped = line.trim();

    // Detect concept section header
    if (/Concepto/.test(line) && /Devengado|A\s*deducir/.test(line)) {
      inConcepts = true;
      continue;
    }

    // Detect end of concept section (totals row)
    if (/Remuneraci[oó]n/i.test(stripped) && /prorr|pagas?\s*extra/i.test(stripped)) {
      inConcepts = false;
      continue;
    }

    // Líquido → net salary
    if (/L[ií]quido/i.test(stripped)) {
      const amt = extractLastAmount(stripped);
      if (amt !== null) netSalary = amt;
    }

    if (inConcepts) {
      parseConceptLineType2(stripped, concepts);
    }
  }

  // ── 3. Extract totals ────────────────────────────────────
  const summaryTotals = extractType2SummaryTotals(lines, netSalary);
  grossSalary = summaryTotals.grossSalary;
  totalDeductions = summaryTotals.totalDeductions;

  // ── 4. Fallbacks ─────────────────────────────────────────
  const totalDevengos = sumConceptAmounts(concepts, "devengo");
  const totalConceptDeductions = sumConceptAmounts(concepts, "deduccion");
  const conceptNetSalary = Math.round((totalDevengos - totalConceptDeductions) * 100) / 100;

  if (
    totalDevengos > 0 &&
    (grossSalary === null || grossSalary <= 0 || (netSalary !== null && Math.abs(conceptNetSalary - netSalary) < 1 && Math.abs(grossSalary - totalDevengos) > 1))
  ) {
    grossSalary = totalDevengos;
  }

  if (netSalary === null && grossSalary !== null) {
    const resolvedDeductions = totalDeductions ?? totalConceptDeductions;
    if (resolvedDeductions > 0) {
      netSalary = Math.round((grossSalary - resolvedDeductions) * 100) / 100;
    } else {
      netSalary = grossSalary;
    }
  }

  // Period and company use the cleaned (box-stripped) text
  const cleanedForMeta = stripBoxDrawingChars(rawText.replace(/\r\n/g, "\n"));
  const period = extractPeriod(cleanedForMeta);
  const company = sanitizeCompanyCandidate(extractCompany(cleanedForMeta));

  return {
    periodMonth: period.month,
    periodYear: period.year,
    company,
    grossSalary,
    netSalary,
    concepts,
    rawText,
  };
}
