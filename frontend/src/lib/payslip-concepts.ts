import type { PayslipConcept } from "./api";

// Tipo semántico de un concepto (lo calcula el backend al guardarlo, ver
// backend/src/parsers/concept-classifier.ts). Respaldo por nombre solo para
// conceptos sin tipo (p. ej. uno recién añadido en el formulario de edición).

type ConceptLike = Pick<PayslipConcept, "name" | "category"> & { kind?: string | null; isPercentage?: boolean };

const IRPF_NAME = /\bi\.?\s?r\.?\s?p\.?\s?f\b|retenci[oó]n a cuenta/i;
const SS_KINDS = new Set(["ss_contingencias", "ss_desempleo", "ss_formacion", "ss_mei", "ss_otros"]);

export function isIrpfConcept(c: ConceptLike): boolean {
  if (c.category !== "deduccion") return false;
  return c.kind ? c.kind === "irpf" : IRPF_NAME.test(c.name);
}

/** Retención de IRPF en euros (excluye las filas de porcentaje). */
export function irpfAmount(concepts: Array<ConceptLike & { amount: number }>): number {
  return concepts.filter((c) => isIrpfConcept(c) && !c.isPercentage).reduce((s, c) => s + c.amount, 0);
}

/** Cotización a la Seguridad Social del trabajador en euros (solo conceptos ya clasificados). */
export function socialSecurityAmount(concepts: Array<ConceptLike & { amount: number }>): number {
  return concepts
    .filter((c) => c.category === "deduccion" && !c.isPercentage && c.kind != null && SS_KINDS.has(c.kind))
    .reduce((s, c) => s + c.amount, 0);
}
