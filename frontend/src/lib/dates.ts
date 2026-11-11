// Fechas de la app: "YYYY-MM-DD" (días) y "YYYY-MM" (meses), en hora local del
// navegador. Un único sitio: antes currentMonth/shiftMonth/monthLabel y la
// fecha ISO local estaban copiados en media docena de componentes.

const pad = (n: number) => String(n).padStart(2, "0");

export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

/** "YYYY-MM-DD" de una fecha en hora local (no toISOString, que va en UTC). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hoy, "YYYY-MM-DD", en hora local. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

/** Mes en curso, "YYYY-MM". */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** "YYYY-MM" desplazado `delta` meses. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const abs = y * 12 + (m - 1) + delta;
  return `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`;
}

/** "Marzo 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** ¿Es "YYYY-MM" con mes válido? */
export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
