import { AuthClient } from "@supabase/auth-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Sin esto, un despliegue o un `npm run build` local sin estas variables
  // falla con el mensaje críptico de supabase-js ("supabaseUrl is required").
  throw new Error(
    "Faltan PUBLIC_SUPABASE_URL o PUBLIC_SUPABASE_ANON_KEY — defínelas en el .env.local de la raíz del monorepo (ver .env.example) o en las variables de entorno del servicio frontend en Vercel.",
  );
}

// Solo usamos la autenticación (Google). supabase-js arrastra además los
// clientes de base de datos, Realtime, Storage y Functions (~200 kB sin
// comprimir) que la app no usa: aquí se crea directamente el mismo cliente de
// auth que crearía `createClient`, con sus mismas opciones por defecto y la
// misma clave de `localStorage` — las sesiones ya abiertas siguen valiendo.
const baseUrl = new URL(url.endsWith("/") ? url : `${url}/`);
const auth = new AuthClient({
  url: new URL("auth/v1", baseUrl).href,
  headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
  storageKey: `sb-${baseUrl.hostname.split(".")[0]}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: "implicit",
});

export const supabase = { auth };
