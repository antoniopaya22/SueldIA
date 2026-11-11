import { looksLikePublicSectorPayslip, matchConceptsType2 } from "../concept-matcher.js";
import type { PayslipFormat } from "./types.js";

/** Notificación de retribuciones de la Administración pública (antes «type2»). */
export const publicSectorFormat: PayslipFormat = {
  id: "public-notification",
  label: "Administración pública (notificación de retribuciones)",
  detect: (text) => (looksLikePublicSectorPayslip(text) ? 0.95 : 0),
  parse: matchConceptsType2,
};
