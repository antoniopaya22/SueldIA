# Backend — Instrucciones para Agentes

## Stack

Express 4 + TypeScript ESM + Drizzle ORM + Postgres (Supabase, driver `postgres`) + Zod + Pino. Sin dependencias nativas — despliega como servicio de Vercel (`vercel.json` en la raíz, modo "Services": detecta `export default app` directamente desde `src/index.ts`, sin wrapper de función).

## Patrón de Rutas Express

Cada dominio tiene su propio archivo en `src/routes/`. Estructura obligatoria:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { tableName } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const domainRouter = Router();

const createSchema = z.object({
  name: z.string().min(1).max(255),
});

domainRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const [result] = await db.insert(tableName).values(parsed.data).returning();
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
```

## Reglas Críticas

- **Imports**: extensión `.js` en imports relativos.
- **Validación**: `zod.safeParse()` → 400 con `error.flatten().fieldErrors`.
- **Auth**: login vía Google, gestionado por Supabase Auth (no hay login/registro propio). El frontend manda el `access_token` de Supabase como `Authorization: Bearer <token>`; `authMiddleware` lo verifica contra el JWKS de Supabase (sin llamar a su API) y crea la fila en `users` la primera vez que ve ese `supabase_user_id`.
- **User ID**: `(req as Request).user!.userId`.
- **Postgres, no SQLite**: el driver de `postgres-js` es asíncrono — nada de `.get()`/`.all()`/`.run()` síncronos. Búsquedas de texto usan `ilike`, no `like` (Postgres es case-sensitive). `count(*)` siempre con cast `::int` (si no, llega como string por ser `bigint`).
- **`created_at`**: columna `timestamp`, no `text` — en TS llega como `Date`, `res.json()` ya lo serializa a ISO string automáticamente.
- **Dinero**: columnas `doublePrecision`, no `numeric` (`numeric` devuelve string en el driver y rompería las sumas `+` del dashboard/analytics).
- **Respuestas**: siempre JSON, mensajes en español.

## Sin OCR, sin storage de archivos

No hay `tesseract.js`/`canvas` ni disco para PDFs — decisión deliberada (ver `AGENTS.md` de la raíz). El upload de nóminas (`multer.memoryStorage()`) procesa el buffer en la propia petición y solo persiste el texto extraído (`rawText`) y los conceptos ya estructurados.

## Parser de Nóminas

`src/parsers/`:
1. **`pdf-text-extractor.ts`** — Extracción posicional con `pdfjs-dist`: agrupa los text items por fila (coordenada Y) y los ordena por columna (X), en vez del volcado lineal de `pdf-parse` (retirado — ni siquiera abría algunos PDFs reales). Huecos grandes en X se marcan con 2+ espacios.
2. **`concept-matcher.ts`** — Regex sobre el texto ya reconstruido: periodo, empresa, salario bruto/neto, conceptos (devengos/deducciones). Dos formatos: `type1` (empresa privada) y `type2` (organismo público, antes basado en bordes `│` — ahora cada fila ya llega limpia, una por línea).
3. **`parser-engine.ts`** — Orquestador mínimo: `extractTextFromPdfBuffer` → `matchConcepts`. Sin reintento (no hay OCR de respaldo en este target).

`POST /:id/reprocess` y `POST /reparse` no releen ningún archivo — re-ejecutan `matchConcepts` sobre el `rawText` ya guardado (para aplicar mejoras del parser, no del extractor).

## Schema de Base de Datos

`src/db/schema.ts` (Drizzle `pg-core`). Tablas: `users`, `profiles`, `payslips` (sin `file_path` — no se guarda el PDF), `payslip_concepts`, `payslip_notes`, `tags`, `payslip_tags`, `alert_rules`, `alert_history`, `accounts`, `category_groups`, `categories`, `transactions`, `recurring_transactions`.

## Configuración

Variables de entorno validadas con Zod en `src/config.ts`:
- `PORT` (default 3001, solo desarrollo local — Vercel lo ignora)
- `DATABASE_URL` (connection string de Postgres/Supabase — Transaction Pooler, puerto 6543; default apunta a un Postgres local para que los tests no necesiten configuración)
- `SUPABASE_URL` (URL del proyecto, para verificar los JWT de Supabase Auth — no confundir con `DATABASE_URL`)
- `NODE_ENV`, `CORS_ORIGIN` (orígenes **extra** permitidos, separados por comas, p. ej. el frontend en local). El mismo origen se acepta siempre (`middleware/cors.ts`): el frontend de producción llama a `/api` en su propio dominio vía rewrite y no hace falta configurar nada en Vercel
- `CRON_SECRET` (opcional — protege `/api/cron/daily`; sin ella esa ruta responde 503)
- `SUPABASE_SERVICE_ROLE_KEY` (opcional — solo para borrar la identidad de Supabase Auth al eliminar una cuenta, `DELETE /api/auth/me`)
