import { readFileSync } from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-expect-error — el worker no trae tipos; solo se registra.
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// En Node, pdfjs usa un «worker falso» en el mismo hilo. Si no lo encuentra en
// globalThis.pdfjsWorker, lo carga con un import() dinámico de una ruta que el
// analizador de dependencias de Vercel no ve, y en producción falla
// («Cannot find module pdf.worker.mjs»). Importarlo aquí de forma estática
// garantiza que se incluye en el despliegue.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const BOX_DRAWING_CHARS = /[│├┤┌┐└┘┬┴┼─═║╔╗╚╝╠╣╦╩╬]/g;
const ROW_Y_TOLERANCE = 2; // pt
const COLUMN_GAP_THRESHOLD = 8; // pt — hueco en X que se interpreta como límite de columna (2+ espacios)

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Reconstruye el texto de una página a partir de los text items posicionados
 * de pdfjs-dist, en vez de depender del orden lineal del stream del PDF
 * (que pdf-parse usaba y que desordena columnas/tablas).
 *
 * Los huecos grandes en X se marcan con 2+ espacios — concept-matcher.ts
 * (formato "type2", nóminas de organismos públicos) trocea cada fila por
 * ese separador para reconstruir las celdas de la tabla.
 */
function reconstructPageText(items: PositionedItem[]): string[] {
  const cleaned = items
    .map((it) => ({ ...it, str: it.str.replace(BOX_DRAWING_CHARS, "").trim() }))
    .filter((it) => it.str !== "");

  const rows = new Map<number, PositionedItem[]>();
  for (const it of cleaned) {
    let key: number | null = null;
    for (const k of rows.keys()) {
      if (Math.abs(k - it.y) <= ROW_Y_TOLERANCE) {
        key = k;
        break;
      }
    }
    if (key === null) key = it.y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(it);
  }

  // Y decrece hacia abajo de la página en el sistema de coordenadas de PDF.
  const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
  const lines: string[] = [];

  for (const [, rowItems] of sortedRows) {
    rowItems.sort((a, b) => a.x - b.x);
    let line = "";
    let lastX: number | null = null;
    for (const it of rowItems) {
      if (lastX !== null) line += it.x - lastX > COLUMN_GAP_THRESHOLD ? "  " : " ";
      line += it.str;
      lastX = it.x + it.str.length * 4;
    }
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }

  return lines;
}

export async function extractTextFromPdf(filePath: string): Promise<string> {
  const data = new Uint8Array(readFileSync(filePath));
  return extractTextFromPdfBuffer(data);
}

// Una nómina real nunca pasa de un puñado de páginas — un límite generoso
// evita que un PDF malicioso (miles de páginas, o páginas con contenido
// pensado para ser lento de renderizar) consuma el tiempo de la función por
// un solo fichero de un lote de hasta 20 (POST /payslips/upload).
const MAX_PAGES = 20;

export async function extractTextFromPdfBuffer(data: Uint8Array): Promise<string> {
  // pdfjs-dist rechaza un Buffer de Node en tiempo de ejecución aunque sea
  // técnicamente un Uint8Array ("Please provide binary data as Uint8Array,
  // rather than Buffer") — Buffer.isBuffer detecta ese caso concreto.
  const safeData = Buffer.isBuffer(data) ? new Uint8Array(data) : data;
  // isEvalSupported: false — defensa adicional (desde pdfjs 4.2 ya no hace
  // falta contra CVE-2024-4367): el PDF lo sube cualquier usuario y se procesa
  // en el mismo proceso que tiene DATABASE_URL. No cambia el texto extraído.
  const doc = await pdfjs.getDocument({ data: safeData, useSystemFonts: true, isEvalSupported: false } as never).promise;
  const allLines: string[] = [];
  const pageCount = Math.min(doc.numPages, MAX_PAGES);

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: PositionedItem[] = content.items.map((item) => {
      const textItem = item as { str: string; transform: number[] };
      return { str: textItem.str, x: textItem.transform[4], y: Math.round(textItem.transform[5]) };
    });
    allLines.push(...reconstructPageText(items));
    page.cleanup();
  }

  await doc.destroy();
  return allLines.join("\n");
}
