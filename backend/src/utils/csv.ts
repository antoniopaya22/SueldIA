// CSV para exportaciones. Un único sitio para escapar (antes estaba duplicado
// en cada ruta) y para neutralizar la inyección de fórmulas: un texto que
// empiece por = + - @ (beneficiarios importados de terceros, notas, nombres de
// fichero…) se ejecutaba como fórmula al abrir el CSV en Excel o LibreOffice.
//
// Formato de hoja de cálculo en español: separador «;» y coma decimal (con
// «,» y punto, Excel en español lo abría todo en una sola columna y leía
// 1234.56 como texto). Quien necesite datos para otro programa tiene el JSON.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else if (typeof value === "number") text = Number.isFinite(value) ? String(value).replace(".", ",") : "";
  else if (typeof value === "boolean") text = value ? "Sí" : "No";
  else {
    text = String(value);
    // Solo textos: un número negativo real no se toca.
    if (FORMULA_START.test(text)) text = `'${text}`;
  }
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV con BOM (Excel lo abre como UTF-8). Con 0 filas devuelve solo la cabecera. */
export function toCsv<K extends string>(headers: readonly K[], rows: ReadonlyArray<Partial<Record<K, unknown>>>): string {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(";"))];
  return "﻿" + lines.join("\r\n");
}
