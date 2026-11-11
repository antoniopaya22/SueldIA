import { useState, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { safeNextPath } from "../lib/safe-next";

export default function LoginPage() {
  const { loginWithGoogle, user, loading, userError, retryUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Si ya hay sesión (p.ej. al volver del redirect de Google), entra directo
  // a la página que se quería abrir (?next=, solo rutas de /app).
  useEffect(() => {
    if (!loading && user) {
      window.location.href = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    }
  }, [loading, user]);

  // Google/Supabase devuelven los errores en la URL (?error=… o #error=…):
  // antes no se mostraba nada y parecía que el botón no hacía nada.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get("error") ?? hash.get("error");
    if (!code) return;
    setOauthError(
      code === "access_denied"
        ? "Has cancelado el acceso con Google. Vuelve a intentarlo cuando quieras."
        : "No se pudo completar el inicio de sesión con Google. Inténtalo de nuevo.",
    );
  }, []);

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de autenticación");
      setSubmitting(false);
    }
  };

  return (
    <>
      {(oauthError || userError) && (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {oauthError ?? "Has iniciado sesión, pero no hemos podido cargar tu cuenta. Comprueba tu conexión."}
          {!oauthError && userError && (
            <button type="button" onClick={retryUser} className="ml-1 font-medium underline underline-offset-2">Reintentar</button>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full gap-2.5"
        disabled={submitting || loading}
        onClick={handleGoogleLogin}
      >
        <svg className="size-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.55 5.55 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.56-5.17 3.56-8.83z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A11.99 11.99 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.6H1.27A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.27 5.4z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.6l4 3.11C6.22 6.86 8.87 4.75 12 4.75z" />
        </svg>
        {loading ? "Comprobando sesión…" : submitting ? "Conectando…" : "Continuar con Google"}
      </Button>
      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        Se crea tu cuenta automáticamente la primera vez. Sin contraseñas, sin formularios.
      </p>
    </>
  );
}
