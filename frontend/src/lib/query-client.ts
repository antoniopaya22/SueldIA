import { QueryClient } from "@tanstack/react-query";

/**
 * Fábrica compartida por `Providers.tsx` (páginas de la app) y
 * `LoginWrapper.tsx` (que no usa el resto de `Providers`, pero desde que
 * `AuthProvider` usa `useQuery(["me"], getMe)` internamente necesita igualmente
 * un `QueryClientProvider` por encima — sin uno, `useQuery` lanza en cuanto se
 * renderiza, incluso en el prerender estático de Astro).
 */
export function createAppQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });

  // Listas de catálogo que casi nunca cambian y ya se invalidan explícitamente
  // tras cada mutación (crear/editar/borrar) — no hace falta refetchearlas por
  // cada navegación dentro del staleTime global de 30s.
  for (const key of ["profiles", "categories", "accounts"]) {
    queryClient.setQueryDefaults([key], { staleTime: 5 * 60_000 });
  }

  return queryClient;
}

/**
 * Cliente único de las islas de /app: AppShell (diálogo global de nueva
 * transacción) y cada página comparten el mismo módulo, así que una
 * mutación hecha desde el shell refresca las listas de la página.
 */
export const appQueryClient = createAppQueryClient();
