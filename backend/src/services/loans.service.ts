import { addMonthsFromBase as addMonthsClamped } from "./recurring-transactions.service.js";

/* ───────── Préstamos e hipotecas: cuadro de amortización ─────────
 * Sistema francés (cuota constante), el habitual en España. Puro y probado:
 * la ruta solo lee la cuenta y le pasa los datos.
 */

export interface LoanTerms {
  /** Importe prestado. */
  principal: number;
  /** TIN anual en % (p. ej. 3,2). */
  annualRate: number;
  months: number;
  /** "YYYY-MM-DD" de la primera cuota; las siguientes, el mismo día de cada mes. */
  firstPaymentDate: string;
}

export interface AmortizationRow {
  n: number;
  date: string;
  payment: number;
  interest: number;
  principal: number;
  /** Capital pendiente tras pagar esta cuota. */
  remaining: number;
}

export interface LoanPosition {
  paidCount: number;
  remainingCount: number;
  interestPaid: number;
  interestRemaining: number;
  /** Capital pendiente según el cuadro, a hoy. */
  theoreticalRemaining: number;
  nextPayment: AmortizationRow | null;
  endDate: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cuota mensual del sistema francés. */
export function monthlyPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 100 / 12;
  if (months <= 0) return 0;
  if (r === 0) return round2(principal / months);
  return round2((principal * r) / (1 - (1 + r) ** -months));
}

export function amortizationSchedule(terms: LoanTerms): AmortizationRow[] {
  const r = terms.annualRate / 100 / 12;
  const payment = monthlyPayment(terms.principal, terms.annualRate, terms.months);
  const rows: AmortizationRow[] = [];
  let remaining = terms.principal;
  for (let n = 1; n <= terms.months; n++) {
    const interest = round2(remaining * r);
    // La última cuota salda lo que quede (el redondeo deja céntimos sueltos).
    const principal = n === terms.months ? round2(remaining) : round2(Math.min(payment - interest, remaining));
    remaining = round2(remaining - principal);
    rows.push({ n, date: addMonthsClamped(terms.firstPaymentDate, n - 1), payment: round2(principal + interest), interest, principal, remaining });
  }
  return rows;
}

/** Dónde está el préstamo hoy según el cuadro (cuotas con fecha ≤ hoy, pagadas). */
export function loanPosition(rows: AmortizationRow[], principal: number, today: string): LoanPosition {
  const paid = rows.filter((r) => r.date <= today);
  const pending = rows.slice(paid.length);
  return {
    paidCount: paid.length,
    remainingCount: pending.length,
    interestPaid: round2(paid.reduce((s, r) => s + r.interest, 0)),
    interestRemaining: round2(pending.reduce((s, r) => s + r.interest, 0)),
    theoreticalRemaining: paid.length ? paid[paid.length - 1].remaining : round2(principal),
    nextPayment: pending[0] ?? null,
    endDate: rows[rows.length - 1]?.date ?? today,
  };
}

/* ───────── Valoraciones (inversiones) ───────────────────────────
 * Una valoración fija el saldo en una fecha: desde entonces, saldo = valor +
 * movimientos posteriores. Se guarda como «ajuste» = valor − saldo contable a
 * esa fecha, y el saldo a cualquier fecha suma el ajuste de la última
 * valoración anterior o igual.
 */

export interface ValuationAdjustment {
  date: string;
  value: number;
  /** Valor − saldo contable (movimientos liquidados) a esa fecha. */
  adjustment: number;
}

/** Ajuste vigente a una fecha (lista ordenada por fecha ascendente); 0 si no hay. */
export function adjustmentAt(list: ValuationAdjustment[] | undefined, date: string): number {
  if (!list) return 0;
  let adj = 0;
  for (const v of list) {
    if (v.date > date) break;
    adj = v.adjustment;
  }
  return adj;
}
