import { extractTextFromPdfBuffer } from "./pdf-text-extractor.js";
import type { ParsedPayslip } from "./concept-matcher.js";
import { matchConcepts } from "./formats/index.js";

// El upload procesa hasta 20 ficheros uno detrás de otro dentro de la misma
// petición (ver payslips.ts) — un PDF patológico (muchas páginas densas,
// fuentes que fuerzan a pdfjs a trabajar de más) no debe poder colgar toda
// la función hasta el límite de Vercel y tirarse abajo el lote entero. Si un
// fichero tarda más de esto, se marca solo ese como error y se sigue con
// los demás (processPayslip ya captura el rechazo).
const PARSE_TIMEOUT_MS = 10_000;

export async function parsePayslip(data: Uint8Array): Promise<ParsedPayslip> {
  const started = performance.now();
  const rawText = await Promise.race([
    extractTextFromPdfBuffer(data),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Tiempo de extracción de PDF agotado")), PARSE_TIMEOUT_MS),
    ),
  ]);
  // Tiempo total (extracción + análisis): una de las métricas de calidad del analizador.
  return { ...matchConcepts(rawText), parseMs: Math.round(performance.now() - started) };
}
