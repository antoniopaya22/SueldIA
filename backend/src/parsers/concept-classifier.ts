// Tipo semántico de cada concepto de la nómina. Antes el IRPF se detectaba
// con name.includes("irpf") en tres sitios (fallaba con «I.R.P.F.» o
// «Retención a cuenta») y la Seguridad Social se calculaba como «lo que
// sobra». Con el tipo guardado se puede desglosar la cotización, comparar
// nóminas concepto a concepto y sumar el IRPF del año para la Renta.

export const CONCEPT_KINDS = [
  // Deducciones
  "irpf",
  "ss_contingencias",
  "ss_desempleo",
  "ss_formacion",
  "ss_mei",
  "ss_otros",
  // Devengos
  "salario_base",
  "complemento",
  "paga_extra",
  "horas_extra",
  "especie",
  "dieta",
  // Cualquier cosa sin clasificar (anticipos, embargos, conceptos raros…)
  "otros",
] as const;

export type ConceptKind = (typeof CONCEPT_KINDS)[number];

/** Grupos de cotización a la Seguridad Social a cargo del trabajador. */
export const SOCIAL_SECURITY_KINDS: readonly ConceptKind[] = ["ss_contingencias", "ss_desempleo", "ss_formacion", "ss_mei", "ss_otros"];

function normalize(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

const has = (n: string, re: RegExp) => re.test(n);

export function classifyConcept(name: string, category: "devengo" | "deduccion" | "otros"): ConceptKind {
  const n = normalize(name);

  if (category === "deduccion") {
    if (has(n, /\bi\.?\s?r\.?\s?p\.?\s?f\b/) || has(n, /retencion (a cuenta|irpf|i\.r)/) || has(n, /\btributacion\b/)) return "irpf";
    if (has(n, /\bm\.?e\.?i\b/) || has(n, /mecanismo (de )?equidad/)) return "ss_mei";
    if (has(n, /contingencias? comun|cont\.? ?comun|\bc\.? ?comunes\b|\bcc\.? ?comunes\b/)) return "ss_contingencias";
    if (has(n, /desempleo/)) return "ss_desempleo";
    if (has(n, /formacion/)) return "ss_formacion";
    if (has(n, /seg(uridad|\.)? ?social|cotizacion|\bs\.s\.?\b|horas extra/)) return "ss_otros";
    return "otros";
  }

  if (category === "devengo") {
    if (has(n, /(salario|sueldo) base/)) return "salario_base";
    if (has(n, /horas? extra/)) return "horas_extra";
    if (has(n, /paga(s)? extra|gratificacion extra|prorrat|\bp\.? ?extra/)) return "paga_extra";
    if (has(n, /especie|seguro (medico|de salud|de vida)|ticket|cheque (comida|restaurante|guarderia)|vehiculo de empresa/)) return "especie";
    if (has(n, /dieta|kilometraje|locomocion|desplazamiento|plus transporte/)) return "dieta";
    if (has(n, /complemento|\bplus\b|antiguedad|trienio|quinquenio|incentivo|bonus|productividad|comision|mejora voluntaria|destino|especifico|nocturnidad|turnicidad|festiv/)) return "complemento";
    return "otros";
  }

  return "otros";
}

type ConceptLike = { name: string; category: string; kind?: string | null; isPercentage?: boolean };

/** Tipo del concepto: el guardado o, si falta (filas antiguas sin rellenar), el calculado. */
export function conceptKind(c: ConceptLike): ConceptKind {
  if (c.kind && (CONCEPT_KINDS as readonly string[]).includes(c.kind)) return c.kind as ConceptKind;
  return classifyConcept(c.name, c.category as "devengo" | "deduccion" | "otros");
}

/** Retención de IRPF en euros (no las filas de porcentaje). */
export function isIrpfAmount(c: ConceptLike): boolean {
  return c.category === "deduccion" && !c.isPercentage && conceptKind(c) === "irpf";
}
