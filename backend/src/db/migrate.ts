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

// Migraciones de datos que necesitan código de la app (no caben en SQL):
// idempotentes, solo tocan filas aún sin rellenar.
{
  const { classifyConcept } = await import("../parsers/concept-classifier.js");
  const pending = await client<{ id: number; name: string; category: "devengo" | "deduccion" | "otros" }[]>`
    SELECT id, name, category FROM payslip_concepts WHERE kind IS NULL
  `;
  for (let i = 0; i < pending.length; i += 500) {
    const chunk = pending.slice(i, i + 500).map((c) => ({ id: c.id, kind: classifyConcept(c.name, c.category) }));
    await client`
      UPDATE payslip_concepts AS pc SET kind = v.kind
      FROM (SELECT * FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(id int, kind text)) AS v
      WHERE pc.id = v.id
    `;
  }
  if (pending.length) console.log(`🏷️  Tipo semántico asignado a ${pending.length} conceptos`);
}
{
  // Formato con el que se leyó cada nómina ya subida (métricas del analizador).
  const { detectFormat } = await import("../parsers/formats/index.js");
  let lastId = 0;
  let filled = 0;
  for (;;) {
    const rows = await client<{ id: number; raw_text: string }[]>`
      SELECT id, raw_text FROM payslips
      WHERE parser_format IS NULL AND raw_text IS NOT NULL AND id > ${lastId}
      ORDER BY id LIMIT 200
    `;
    if (rows.length === 0) break;
    const chunk = rows.map((r) => ({ id: r.id, format: detectFormat(r.raw_text).format.id }));
    await client`
      UPDATE payslips AS p SET parser_format = v.format
      FROM (SELECT * FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS x(id int, format text)) AS v
      WHERE p.id = v.id
    `;
    lastId = rows[rows.length - 1].id;
    filled += rows.length;
  }
  if (filled) console.log(`🧾 Formato del analizador anotado en ${filled} nóminas`);
}

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
