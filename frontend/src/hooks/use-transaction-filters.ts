import { useCallback, useEffect, useRef, useState } from "react";
import { parseTxFilters, writeTxFilters, type TxUrlFilters } from "../lib/transaction-filters";

/**
 * Filtros de Transacciones sincronizados con la URL (se leen al montar y se
 * escriben con replaceState en cada cambio). Cambiar un filtro vuelve a la
 * página 1; la página en sí no va a la URL.
 */
export function useTransactionFilters() {
  const [filters, setFilters] = useState<TxUrlFilters>(() =>
    typeof window === "undefined" ? {} : parseTxFilters(window.location.search),
  );
  const [page, setPage] = useState(1);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    writeTxFilters(filters);
  }, [filters]);

  /** Fusiona un cambio; `undefined` en una clave la quita. */
  const update = useCallback((patch: Partial<TxUrlFilters>) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      for (const key of Object.keys(next) as (keyof TxUrlFilters)[]) if (next[key] === undefined) delete next[key];
      return next;
    });
    setPage(1);
  }, []);

  /** Quita todos los filtros menos la cuenta (que hace de pestaña, no de filtro). */
  const clear = useCallback(() => {
    setFilters((current) => (current.accountId ? { accountId: current.accountId } : {}));
    setPage(1);
  }, []);

  return { filters, update, clear, page, setPage };
}
