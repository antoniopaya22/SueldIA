import type { ParsedPayslip } from "../concept-matcher.js";
import { privateCompanyFormat } from "./private-company.js";
import { publicSectorFormat } from "./public-sector.js";
import type { PayslipFormat } from "./types.js";

export type { PayslipFormat } from "./types.js";

/**
 * Formatos conocidos. Gana el de mayor confianza; a igualdad, el primero de la
 * lista. El de empresa privada va el último: es el de reserva.
 */
export const FORMATS: readonly PayslipFormat[] = [publicSectorFormat, privateCompanyFormat];

/** Formato elegido para un texto, con su confianza. */
export function detectFormat(text: string, formats: readonly PayslipFormat[] = FORMATS): { format: PayslipFormat; confidence: number } {
  let best = { format: formats[formats.length - 1], confidence: -1 };
  for (const format of formats) {
    const confidence = format.detect(text);
    if (confidence > best.confidence) best = { format, confidence };
  }
  return best;
}

/** Analiza el texto extraído de una nómina con el formato que mejor encaja. */
export function matchConcepts(rawText: string): ParsedPayslip {
  const { format } = detectFormat(rawText);
  return { ...format.parse(rawText), format: format.id };
}
