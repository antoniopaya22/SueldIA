// El diálogo de "Nueva transacción" vive en el shell (AppShell) para poder
// abrirse desde cualquier página de /app. Quien quiera abrirlo (cabecera,
// paleta ⌘K, atajo N) lo pide con este evento en vez de navegar.

export const NEW_TRANSACTION_EVENT = "sueldia:new-transaction";

export type NewTransactionType = "expense" | "income" | "transfer";

export function openNewTransaction(type: NewTransactionType = "expense") {
  window.dispatchEvent(new CustomEvent(NEW_TRANSACTION_EVENT, { detail: { type } }));
}
