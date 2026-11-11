import { conceptKind, SOCIAL_SECURITY_KINDS } from "../parsers/concept-classifier.js";
import { normalizeText } from "../utils/text.js";

// Comparar dos nóminas concepto a concepto (qué ha subido, qué ha bajado, qué
// es nuevo y qué ha desaparecido) y resumir un año para la declaración de la
// Renta. Lógica pura, sin BBDD, para poder probarla.

export interface ConceptForCompare {
  name: string;
  category: "devengo" | "deduccion" | "otros";
  amount: number;
  isPercentage: boolean;
  kind?: string | null;
}

export interface ConceptDiff {
  name: string;
  category: ConceptForCompare["category"];
  current: number | null;
  other: number | null;
  /** current − other (null si falta en alguna de las dos). */
  change: number | null;
}

/** Empareja por nombre normalizado; las filas de porcentaje no se comparan. */
export function diffConcepts(current: ConceptForCompare[], other: ConceptForCompare[]): ConceptDiff[] {
  const key = (c: ConceptForCompare) => `${c.category}|${normalizeText(c.name)}`;
  const sumBy = (list: ConceptForCompare[]) => {
    const m = new Map<string, { name: string; category: ConceptForCompare["category"]; amount: number }>();
    for (const c of list) {
      if (c.isPercentage) continue;
      const k = key(c);
      const prev = m.get(k);
      m.set(k, { name: prev?.name ?? c.name, category: c.category, amount: (prev?.amount ?? 0) + c.amount });
    }
    return m;
  };
  const a = sumBy(current);
  const b = sumBy(other);
  const rows: ConceptDiff[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k);
    const y = b.get(k);
    const cur = x ? Math.round(x.amount * 100) / 100 : null;
    const oth = y ? Math.round(y.amount * 100) / 100 : null;
    rows.push({
      name: (x ?? y)!.name,
      category: (x ?? y)!.category,
      current: cur,
      other: oth,
      change: cur != null && oth != null ? Math.round((cur - oth) * 100) / 100 : null,
    });
  }
  const order = { devengo: 0, deduccion: 1, otros: 2 };
  return rows.sort((r, s) => order[r.category] - order[s.category] || Math.abs(s.current ?? s.other ?? 0) - Math.abs(r.current ?? r.other ?? 0));
}

export interface TaxSummary {
  year: number;
  payslips: number;
  /** Suma de brutos (retribuciones dinerarias íntegras, aproximación). */
  grossTotal: number;
  irpfWithheld: number;
  socialSecurity: number;
  netTotal: number;
  inKind: number;
  /** Tipo medio de retención sobre el bruto (%). */
  effectiveIrpfRate: number | null;
  /** Meses del año sin nómina mensual (huecos). */
  missingMonths: number[];
}

export function buildTaxSummary(
  year: number,
  payslips: Array<{ id: number; grossSalary: number | null; netSalary: number | null; periodMonth: number | null; payslipType: string }>,
  concepts: Array<ConceptForCompare & { payslipId: number }>,
): TaxSummary {
  const round = (n: number) => Math.round(n * 100) / 100;
  const ids = new Set(payslips.map((p) => p.id));
  let irpf = 0;
  let ss = 0;
  let inKind = 0;
  for (const c of concepts) {
    if (!ids.has(c.payslipId) || c.isPercentage) continue;
    const kind = conceptKind(c);
    if (c.category === "deduccion" && kind === "irpf") irpf += c.amount;
    else if (c.category === "deduccion" && SOCIAL_SECURITY_KINDS.includes(kind)) ss += c.amount;
    else if (c.category === "devengo" && kind === "especie") inKind += c.amount;
  }
  const gross = payslips.reduce((s, p) => s + (p.grossSalary ?? 0), 0);
  const net = payslips.reduce((s, p) => s + (p.netSalary ?? 0), 0);
  const months = new Set(payslips.filter((p) => p.payslipType === "ordinal" && p.periodMonth).map((p) => p.periodMonth!));
  return {
    year,
    payslips: payslips.length,
    grossTotal: round(gross),
    irpfWithheld: round(irpf),
    socialSecurity: round(ss),
    netTotal: round(net),
    inKind: round(inKind),
    effectiveIrpfRate: gross > 0 ? round((irpf / gross) * 100) : null,
    missingMonths: Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !months.has(m)),
  };
}
