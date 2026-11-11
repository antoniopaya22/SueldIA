// Estimación APROXIMADA del IRPF anual de las rentas del trabajo, para saber
// si la retención de la nómina va corta (a pagar en la Renta) o larga (a
// devolver). No es un cálculo fiscal: no tiene en cuenta la comunidad
// autónoma, la situación familiar, discapacidad, deducciones ni otras rentas.
// Parámetros generales de 2025; revísalos cada año.
export const IRPF_PARAMS = {
  year: 2025,
  /** Escala general (estatal + autonómica tipo): [desde, tipo marginal]. */
  scale: [
    [0, 0.19],
    [12_450, 0.24],
    [20_200, 0.30],
    [35_200, 0.37],
    [60_000, 0.45],
    [300_000, 0.47],
  ] as const,
  personalAllowance: 5_550,
  /** Otros gastos deducibles de los rendimientos del trabajo. */
  otherExpenses: 2_000,
  /** Reducción por obtención de rendimientos del trabajo. */
  workReduction(netIncome: number): number {
    if (netIncome <= 14_852) return 7_302;
    if (netIncome <= 17_673.52) return 7_302 - 1.75 * (netIncome - 14_852);
    if (netIncome <= 19_747.5) return 2_364.34 - 1.14 * (netIncome - 17_673.52);
    return 0;
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Cuota de la escala para una base (puro). */
export function scaleTax(base: number): number {
  let tax = 0;
  const s = IRPF_PARAMS.scale;
  for (let i = 0; i < s.length; i++) {
    const [from, rate] = s[i];
    const to = i + 1 < s.length ? s[i + 1][0] : Infinity;
    if (base <= from) break;
    tax += (Math.min(base, to) - from) * rate;
  }
  return tax;
}

/** IRPF anual aproximado de unos rendimientos del trabajo (bruto y cotizaciones del año). */
export function estimateAnnualIrpf(grossAnnual: number, socialSecurityAnnual: number) {
  const netBeforeReduction = Math.max(0, grossAnnual - socialSecurityAnnual);
  const reduction = Math.max(0, IRPF_PARAMS.workReduction(netBeforeReduction));
  const base = Math.max(0, netBeforeReduction - IRPF_PARAMS.otherExpenses - reduction);
  const tax = Math.max(0, scaleTax(base) - scaleTax(Math.min(base, IRPF_PARAMS.personalAllowance)));
  return { base: round(base), tax: round(tax), effectiveRate: grossAnnual > 0 ? round((tax / grossAnnual) * 100) : 0 };
}

export interface IrpfEstimate {
  paramsYear: number;
  /** El año está completo (o no falta ningún mes) y no hace falta proyectar. */
  complete: boolean;
  projectedGross: number;
  projectedWithheld: number;
  estimatedTax: number;
  estimatedRate: number;
  /** Positivo: a pagar en la Renta; negativo: a devolver. */
  difference: number;
  verdict: "short" | "long" | "ok";
}

/**
 * Proyecta lo cobrado y retenido hasta ahora al año completo (al ritmo de los
 * meses subidos) y lo compara con el impuesto estimado. `monthsCovered`: meses
 * con nómina mensual subida (0–12). Menos de 3 meses: no se estima.
 */
export function irpfEstimate(summary: { grossTotal: number; irpfWithheld: number; socialSecurity: number }, monthsCovered: number): IrpfEstimate | null {
  if (monthsCovered < 3 || summary.grossTotal <= 0) return null;
  const factor = 12 / Math.min(12, monthsCovered);
  const projectedGross = summary.grossTotal * factor;
  const projectedWithheld = summary.irpfWithheld * factor;
  const { tax, effectiveRate } = estimateAnnualIrpf(projectedGross, summary.socialSecurity * factor);
  const difference = round(tax - projectedWithheld);
  // Un margen razonable: diferencias pequeñas no merecen un aviso.
  const margin = Math.max(150, projectedGross * 0.005);
  return {
    paramsYear: IRPF_PARAMS.year,
    complete: monthsCovered >= 12,
    projectedGross: round(projectedGross),
    projectedWithheld: round(projectedWithheld),
    estimatedTax: tax,
    estimatedRate: effectiveRate,
    difference,
    verdict: difference > margin ? "short" : difference < -margin ? "long" : "ok",
  };
}
