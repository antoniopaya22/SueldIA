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
2. **`formats/`** — Registro de formatos (`PayslipFormat`: `id`, `detect(texto) → 0..1`, `parse(texto)`). `matchConcepts` (en `formats/index.ts`) elige el de más confianza y anota su `id` en el resultado. Hoy: `public-notification` (notificación de retribuciones de la Administración) y `private-generic` (modelo oficial de empresa privada, formato de reserva). Ver «Añadir un formato de nómina» en el README.
3. **`concept-matcher.ts`** — Las reglas (regex) de los dos formatos actuales sobre el texto ya reconstruido: periodo, empresa, salario bruto/neto, conceptos (devengos/deducciones).
4. **`parser-engine.ts`** — Orquestador mínimo: `extractTextFromPdfBuffer` → `matchConcepts`, y mide el tiempo (`parseMs`). Sin reintento (no hay OCR de respaldo en este target).

Métricas de calidad: `payslips.parser_format` y `payslips.parse_ms`, más la línea de log «Nómina analizada» (formato, estado, ms, nº de conceptos — nunca nombres ni importes).

`POST /:id/reprocess` y `POST /reparse` no releen ningún archivo — re-ejecutan `matchConcepts` sobre el `rawText` ya guardado (para aplicar mejoras del parser, no del extractor).

## Schema de Base de Datos

`src/db/schema.ts` (Drizzle `pg-core`). Tablas: `users`, `profiles`, `payslips` (sin `file_path` — no se guarda el PDF), `payslip_concepts`, `payslip_notes`, `tags`, `payslip_tags`, `alert_rules`, `alert_history`, `accounts`, `category_groups`, `categories`, `transactions`, `recurring_transactions`, `budgets`, `category_targets`, `category_rules`, `user_preferences`, `savings_goals`, `account_valuations`, `push_subscriptions`, `activity_log`, `shares`, `share_invites`.

- **Compartir en solo lectura** («ver como»): con la cabecera `X-View-As: <id del titular>`, `authMiddleware` comprueba que hay un `share` y pone `req.user` = titular (`req.viewer` = quien llama). Cualquier método que no sea GET, y `/api/export`, da 403 (`code: "read_only"`); sin acceso, 403 `view_as_revoked`. `/api/auth`, `/api/sharing`, `/api/push`, `/api/preferences` y `/api/client-errors` siempre van con la identidad propia (`OWN_IDENTITY`). Una ruta GET nunca debe escribir datos: la puede llamar quien solo mira.

- **Registro de actividad**: una ruta nueva que modifique datos del usuario se añade a `ACTIVITY` (`services/activity.service.ts`) con su texto en español; la prueba de `authorization.test.ts` comprueba que cada clave corresponde a una ruta real.

- **Saldos**: `getAccountsWithBalance` es la fuente única (inicial + liquidados + ajuste de la última valoración, ver `services/loans.service.ts`). La previsión en total y la alerta de saldo bajo no cuentan préstamos ni hipotecas (no son dinero disponible); «saldo total» y el patrimonio, sí.

- **Toda tabla lleva `.enableRLS()`** (sin políticas): cierra la Data API de Supabase. `db:migrate` falla si falta.
- **Fechas**: `isoDateSchema` / `monthKeySchema` de `utils/dates.ts` (rechazan fechas que no existen) y `todayIso()` para "hoy" en hora de Madrid. Nunca una regex suelta ni `new Date().toISOString()` para el día.
  Las columnas de fecha (`transactions.date`, `scheduled_for`, `start_date`/`end_date`, `target_date`) son tipo `date` (Drizzle `mode: "string"`: llegan como «YYYY-MM-DD»). Para el fin de mes usa `lastDayOfMonth("YYYY-MM")`: el antiguo truco de comparar con «YYYY-MM-31» ya no vale (Postgres rechaza la fecha). Para agrupar por mes, `to_char(fecha, 'YYYY-MM')`.
- **Importes**: `moneySchema` / `positiveMoneySchema` de `utils/validation.ts` (finitos y acotados).
- **CSV**: `toCsv()` de `utils/csv.ts` (escapa y neutraliza fórmulas).
- **Altas**: `assertUnderLimit()` de `utils/limits.ts` para los topes por usuario.
- **Copia de seguridad**: `services/backup-restore.service.ts` genera `/export/all` (`buildFullExport`) y lo restaura (`POST /import/backup`, reasignando ids). Una tabla o columna nueva con datos del usuario debe añadirse a los dos sitios (y a `backup-restore.integration.test.ts`), o se perderá al restaurar.
- **Pruebas de integración**: `src/test/` + `TEST_DATABASE_URL`. Toda ruta nueva que reciba un id debe añadirse a `routes/authorization.test.ts`.

## Configuración

Variables de entorno validadas con Zod en `src/config.ts`:
- `PORT` (default 3001, solo desarrollo local — Vercel lo ignora)
- `DATABASE_URL` (connection string de Postgres/Supabase — Transaction Pooler, puerto 6543; default apunta a un Postgres local para que los tests no necesiten configuración)
- `SUPABASE_URL` (URL del proyecto, para verificar los JWT de Supabase Auth — no confundir con `DATABASE_URL`)
- `NODE_ENV`, `CORS_ORIGIN` (orígenes **extra** permitidos, separados por comas, p. ej. el frontend en local). El mismo origen se acepta siempre (`middleware/cors.ts`): el frontend de producción llama a `/api` en su propio dominio vía rewrite y no hace falta configurar nada en Vercel
- `CRON_SECRET` (opcional — protege `/api/cron/daily`; sin ella esa ruta responde 503)
- `SUPABASE_SERVICE_ROLE_KEY` (opcional — solo para borrar la identidad de Supabase Auth al eliminar una cuenta, `DELETE /api/auth/me`)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (opcionales — avisos push de las alertas, `services/push.service.ts`; sin ellas `/api/push/*` responde 503). `evaluateRulesForUser` manda un único aviso por evaluación con el nombre de la regla, nunca importes.
