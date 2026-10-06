import { eq } from "drizzle-orm";
import { transactions } from "../db/schema.js";

// Criterio ÚNICO de "movimiento efectivo": solo los liquidados (`cleared`)
// mueven el saldo de las cuentas y cuentan en la analítica y el presupuesto.
// Los pendientes (recurrentes recién generadas, movimientos futuros) no
// afectan a ninguna cifra hasta que se liquidan. Si cambia la regla, cambia
// aquí y las tres pantallas siguen cuadrando entre sí.
export const effectiveTransaction = () => eq(transactions.cleared, true);

/**
 * Estado inicial de un movimiento creado a mano si el cliente no lo indica:
 * liquidado si la fecha es de hoy o anterior; pendiente si es futura. Sin
 * esto, apuntar un gasto de hoy lo dejaba "pendiente" y no se reflejaba en el
 * saldo ni en las gráficas.
 */
export function defaultCleared(date: string, today: string): boolean {
  return date <= today;
}
