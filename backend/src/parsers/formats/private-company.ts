import { matchConceptsType1 } from "../concept-matcher.js";
import type { PayslipFormat } from "./types.js";

/**
 * Nómina de empresa privada con el modelo oficial (devengos, deducciones,
 * líquido a percibir; antes «type1»). Es también el formato de reserva: nunca
 * devuelve 0, así que se usa cuando ningún otro reconoce el texto.
 */
export const privateCompanyFormat: PayslipFormat = {
  id: "private-generic",
  label: "Empresa privada (modelo oficial)",
  detect: (text) => {
    let score = 0.2;
    if (/DEVENGOS/i.test(text) && /DEDUCCI[OÓ]N/i.test(text)) score += 0.3;
    if (/L[IÍ]QUIDO\s+(TOTAL\s+)?A\s+PERCIBIR/i.test(text)) score += 0.3;
    return score;
  },
  parse: matchConceptsType1,
};
