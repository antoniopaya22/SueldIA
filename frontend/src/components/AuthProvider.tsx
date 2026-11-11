import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { type AuthUser, getMe } from "../lib/api";
import { supabase } from "../lib/supabase";

interface AuthContext {
  user: AuthUser | null;
  loading: boolean;
  /** Hay sesión de Supabase pero no se pudo cargar el usuario de la API. */
  userError: Error | null;
  retryUser: () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthContext | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // null = comprobando todavía la sesión de Supabase (getSession() es async).
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      // Sin sesión en /app: directamente al login (antes se veía el shell con
      // esqueletos hasta el primer 401), recordando adónde se quería ir.
      if (!session && window.location.pathname.startsWith("/app")) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login?next=${next}`);
      }
    });

    // Se dispara tras el redirect de vuelta de Google, y en el refresco
    // automático de la sesión que hace el propio cliente de Supabase.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Misma query (clave "me") que una página pueda usar directamente (p. ej.
  // HomeDashboardPage) — React Query la comparte en vez de duplicarla: antes
  // esto y una página así hacían dos peticiones idénticas a /auth/me en
  // cada carga. Un 401 ya lo gestiona request() en lib/api.ts (signOut +
  // redirect a /login), así que aquí basta con no reintentar.
  const { data: user, isLoading: userLoading, error: userError, refetch: retryUser } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: hasSession === true,
    retry: false,
  });

  const loading = hasSession === null || (hasSession === true && userLoading);

  const loginWithGoogle = useCallback(async () => {
    // Se conserva ?next= para volver a la página que se quería abrir.
    const next = new URLSearchParams(window.location.search).get("next");
    const redirectTo = `${window.location.origin}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    // signInWithOAuth no lanza: devuelve el error (antes se ignoraba y el
    // botón se quedaba en "Conectando…" para siempre).
    if (error) throw new Error("No se pudo conectar con Google. Inténtalo de nuevo.");
    // A partir de aquí el navegador redirige a Google — no hay nada más que
    // hacer en esta función, la sesión se recoge sola al volver (ver arriba).
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // A la landing, no a /login: quien cierra sesión a propósito no
    // necesita ver el formulario de entrar otra vez de inmediato.
    window.location.href = "/";
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user: user ?? null,
        loading,
        userError: (userError as Error | null) ?? null,
        retryUser: () => void retryUser(),
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be within AuthProvider");
  return ctx;
}
