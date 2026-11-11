import { z } from "zod";

// Fechas de la app: texto "YYYY-MM-DD" (días) y "YYYY-MM" (meses), siempre en
// hora de España. El servidor corre en UTC (Vercel): sin fijar la zona, entre
// las 00:00 y la 01:00/02:00 de Madrid el "hoy" del servidor sería ayer — un
// gasto de hoy quedaría como futuro/pendiente y el día 1 se vería el mes anterior.
export const APP_TIME_ZONE = "Europe/Madrid";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" de hoy en hora de Madrid. */
export function todayIso(reference: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return ymdFormatter.format(reference);
}

/** "YYYY-MM" del mes en curso en hora de Madrid. */
export function currentMonthKey(reference: Date = new Date()): string {
  return todayIso(reference).slice(0, 7);
}

/** Año y mes (1-12) en curso en hora de Madrid. */
export function currentYearMonth(reference: Date = new Date()): { year: number; month: number } {
  const [year, month] = todayIso(reference).split("-").map(Number);
  return { year, month };
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** true si es "YYYY-MM-DD" y además una fecha que existe (rechaza 2025-02-30, 2025-13-01…). */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** true si es "YYYY-MM" con mes 01-12 y un año razonable. */
export function isValidMonthKey(value: string): boolean {
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  return year >= 1900 && year <= 2200;
}

// Esquemas Zod compartidos — toda ruta que reciba una fecha debe usar estos
// en vez de una regex suelta: una regex acepta "2025-02-32", que luego hace
// lanzar RangeError a `new Date(...).toISOString()` (y así rompía el cron
// diario de recurrentes para todos los usuarios).
export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: "Fecha inválida (formato YYYY-MM-DD)" });

export const monthKeySchema = z
  .string()
  .refine(isValidMonthKey, { message: "Mes inválido (formato YYYY-MM)" });
