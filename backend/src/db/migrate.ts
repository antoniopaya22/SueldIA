import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// `vercel.json` ejecuta este script como buildCommand del servicio backend —
// eso incluye cada preview deploy, no solo producción. Como solo hay una
// base de datos (Supabase), un preview migraría la BBDD de producción. Solo
// se salta automáticamente en Vercel cuando el entorno no es "production";
// en local (VERCEL_ENV no está definida) y en CI sigue ejecutándose siempre.
//
// Importante: esta comprobación tiene que pasar ANTES de importar
// "./index.js" (import estático, no dinámico) — ese módulo construye el
// cliente de postgres-js en cuanto se carga, y si DATABASE_URL no está
// configurada para Preview (o llega vacía) revienta con "Invalid URL" antes
// de que este if llegue a ejecutarse. Por eso el import de más abajo es
// dinámico: así no se evalúa en absoluto cuando se salta.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(
    `⏭️  Saltando migraciones automáticas: VERCEL_ENV="${process.env.VERCEL_ENV}" (no es "production"). ` +
      `Ejecuta "npm run db:migrate" a mano si este preview necesita su propia base de datos.`,
  );
  process.exit(0);
}

const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const { db, client } = await import("./index.js");

await migrate(db, { migrationsFolder: resolve(__dirname, "./migrations") });

// Red de seguridad: ninguna tabla de `public` puede quedar sin RLS (Supabase
// la expone por la Data API con la anon key, que es pública). Si alguien añade
// una tabla sin `.enableRLS()` en schema.ts, el despliegue falla aquí.
const tablesWithoutRls = await client<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false
`;
await client.end();

if (tablesWithoutRls.length > 0) {
  console.error(
    `❌ Tablas sin Row Level Security: ${tablesWithoutRls.map((t) => t.tablename).join(", ")}. ` +
      `Añade .enableRLS() a su pgTable en src/db/schema.ts y genera la migración.`,
  );
  process.exit(1);
}

console.log("✅ Migrations applied successfully");
