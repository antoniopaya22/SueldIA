// Comparar con el periodo anterior: lógica pura (sin React) para poder
// comprobarla con un script. El periodo anterior es el de la misma duración
// inmediatamente anterior al elegido.

const DAY_MS = 86_400_000;

function parse(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  return format(parse(iso) + days * DAY_MS);
}

/** Número de días del rango, ambos extremos incluidos. */
export function rangeDays(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS) + 1;
}

/**
 * Periodo de la misma duración justo antes de `from`. Sin comparación posible
 * (rango abierto o invertido) devuelve null.
 */
export function previousRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to || from > to) return null;
  const days = rangeDays(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(days - 1)), to: prevTo };
}

function lastDayOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * ¿Está este mes ("YYYY-MM") cortado por el borde del rango? Su total no es
 * comparable con el de un mes entero (p. ej. el primer mes de un periodo que
 * empieza el día 26).
 */
export function isPartialMonth(month: string, range: { from: string; to: string }): boolean {
  if (month === range.from.slice(0, 7) && Number(range.from.slice(8, 10)) !== 1) return true;
  if (month === range.to.slice(0, 7) && Number(range.to.slice(8, 10)) !== lastDayOfMonth(month)) return true;
  return false;
}

/** Variación porcentual; null si no hay base con la que comparar. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type ChangeTrend = "up" | "down" | "flat";

export function changeTrend(change: number | null): ChangeTrend {
  if (change === null || Math.abs(change) < 0.05) return "flat";
  return change > 0 ? "up" : "down";
}

/** Une dos series mensuales por posición: el mes i del periodo con el mes i del anterior. */
export function alignPrevious<T extends { label: string }, P extends { label: string }>(
  current: T[],
  previous: P[],
  pick: (item: P) => number | null,
): Array<T & { previous: number | null; previousLabel: string | null }> {
  return current.map((item, index) => {
    const prev = previous[index];
    return { ...item, previous: prev ? pick(prev) : null, previousLabel: prev ? prev.label : null };
  });
}

/** Cambio por clave (categoría, beneficiario…) entre dos listados. */
export function changeByKey(
  current: Array<{ key: string; value: number }>,
  previous: Map<string, number>,
): Map<string, number | null> {
  return new Map(current.map((item) => [item.key, pctChange(item.value, previous.get(item.key) ?? 0)]));
}
