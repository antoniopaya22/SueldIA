import type { QueryClient } from "@tanstack/react-query";

// Todo lo que depende de los movimientos: listados, saldos, analítica,
// presupuesto, sugerencias y el emparejado nómina ↔ ingreso. Tras crear,
// editar o borrar un movimiento se refresca todo junto para que ninguna
// pantalla muestre cifras viejas (antes solo se refrescaban tres de ellas).
const FINANCE_QUERY_KEYS = [
  "transactions",
  "accounts",
  "finance-analytics",
  "finance-trends",
  "finance-summary",
  "finance-dashboard",
  "budgets",
  "payee-suggestions",
  "recurring-suggestions",
  "finance-report",
  "balance-history",
  "forecast",
  "payslip-link-suggestions",
  // Paneles de la analítica con su propia serie (ritmo, calendario, importes)
  // y las reglas recurrentes (contadores de pendientes/vencidas): se quedaban
  // con cifras viejas tras crear o editar un movimiento.
  "finance-daily",
  "finance-amounts",
  "recurring-transactions",
] as const;

export function invalidateFinance(queryClient: QueryClient) {
  for (const key of FINANCE_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
}
