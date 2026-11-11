import { useCallback, useMemo } from "react";
import { parseTxFilters, writeTxFilters, type TxUrlFilters } from "../lib/transaction-filters";
import { useLocationSearch, useUrlIntParam } from "../lib/url-state";

/**
 * Filtros de Transacciones leídos de la URL (y escritos en ella con
 * replaceState): la URL es la única fuente de verdad, así que Atrás/Adelante,
 * un enlace desde un gráfico o una recarga dejan la lista igual. Cambiar un
 * filtro vuelve a la página 1; la página también va en la URL (?pagina=).
 */
export function useTransactionFilters() {
  const search = useLocationSearch();
  const filters = useMemo(() => parseTxFilters(search), [search]);
  const [page, setPageParam] = useUrlIntParam("pagina", 1);

  /** Fusiona un cambio; `undefined` en una clave la quita. */
  const update = useCallback((patch: Partial<TxUrlFilters>) => {
    const next = { ...parseTxFilters(window.location.search), ...patch };
    for (const key of Object.keys(next) as (keyof TxUrlFilters)[]) if (next[key] === undefined) delete next[key];
    writeTxFilters(next);
  }, []);

  /** Quita todos los filtros menos la cuenta (que hace de pestaña, no de filtro). */
  const clear = useCallback(() => {
    const current = parseTxFilters(window.location.search);
    writeTxFilters(current.accountId ? { accountId: current.accountId } : {});
  }, []);

  const setPage = useCallback((p: number) => setPageParam(p), [setPageParam]);

  return { filters, update, clear, page, setPage };
}
