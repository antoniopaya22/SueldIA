import type { ParsedPayslip } from "../concept-matcher.js";

/**
 * Un formato de nómina (el de un programa de nóminas o un organismo concreto).
 * Para añadir uno: un fichero en esta carpeta que implemente esta interfaz,
 * su entrada en `FORMATS` (index.ts) y pruebas con nóminas anonimizadas.
 */
export interface PayslipFormat {
  /** Identificador estable: se guarda en `payslips.parser_format`. */
  id: string;
  /** Nombre legible (registros y métricas). */
  label: string;
  /** Confianza de 0 a 1 en que el texto es de este formato. 0 = seguro que no. */
  detect(text: string): number;
  parse(text: string): ParsedPayslip;
}
