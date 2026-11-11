import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Sin dominio propio todavía (0 dominios en el proyecto de Vercel) — usa
  // el alias estable *.vercel.app del propio proyecto. Cambiar aquí en
  // cuanto haya un dominio de verdad; de esto salen las canonical/OG y el
  // sitemap.
  site: "https://sueldia.vercel.app",
  integrations: [react()],
  // Cada página de /app es una carga completa: precargar el HTML al pasar el
  // ratón por un enlace (o al tocarlo en móvil) adelanta la navegación sin
  // cambiar la arquitectura de islas.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    // El único .env.example/.env.local del proyecto vive en la raíz del
    // monorepo (variables de backend y frontend juntas) — sin esto, Vite solo
    // busca .env aquí en frontend/ y el build falla con "supabaseUrl is required".
    envDir: "..",
    server: {
      proxy: {
        "/api": "http://localhost:3001",
      },
    },
  },
});
