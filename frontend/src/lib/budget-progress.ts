// Cálculos de presentación del presupuesto (sin React, para poder probarlos).

export type SpendTone = "none" | "ok" | "warn" | "over";

interface ProgressInput {
  assigned: number;
  /** Gasto del mes en negativo (tal como lo devuelve la API). */
  activity: number;
  available: number;
  /** Lo que ya había al empezar el mes. */
  carryIn: number;
}

export interface SpendProgress {
  spent: number;
  /** Con lo que se contaba este mes: arrastre + asignado. */
  limit: number;
  /** 0–1, para el ancho de la barra (tope en 1 aunque se haya pasado). */
  ratio: number;
  tone: SpendTone;
}

/** Cuánto del presupuesto del mes se ha gastado, y con qué semáforo. */
export function spendProgress(c: ProgressInput): SpendProgress {
  const spent = Math.max(0, -c.activity);
  const limit = c.carryIn + c.assigned;
  // `available` ya descuenta el arrastre negativo de meses pasados: es la verdad para "pasado".
  const over = c.available < -0.005;
  if (over) return { spent, limit, ratio: 1, tone: "over" };
  if (limit <= 0) return { spent, limit, ratio: 0, tone: "none" };
  const ratio = Math.min(spent / limit, 1);
  if (spent === 0) return { spent, limit, ratio: 0, tone: "none" };
  return { spent, limit, ratio, tone: ratio >= 0.85 ? "warn" : "ok" };
}

export interface GroupTotals {
  assigned: number;
  spent: number;
  available: number;
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

/** Totales de un grupo de categorías (lo que se enseña en su cabecera). */
export function groupTotals(categories: ProgressInput[]): GroupTotals {
  return {
    assigned: roundCents(categories.reduce((s, c) => s + c.assigned, 0)),
    spent: roundCents(categories.reduce((s, c) => s + Math.max(0, -c.activity), 0)),
    available: roundCents(categories.reduce((s, c) => s + c.available, 0)),
  };
}
