# SueldIA — Instrucciones Globales para Copilot

## Fuente de verdad

Estas instrucciones son un resumen. Las reglas completas y actualizadas están en:

- [`AGENTS.md`](../AGENTS.md) — visión general, arquitectura, flujo de parsing, convenciones de commits y reglas para agentes
- [`backend/AGENTS.md`](../backend/AGENTS.md) — patrón de rutas Express, reglas de Postgres/Drizzle, helpers compartidos, configuración
- [`frontend/AGENTS.md`](../frontend/AGENTS.md) — páginas Astro + islas React, API client, auth, sistema de diseño, CSP
- [`README.md`](../README.md) — desarrollo local, pruebas, migraciones y despliegue

Si algo de este directorio `.github/` contradice esos archivos, mandan los `AGENTS.md`.

## Proyecto en una frase

Aplicación web (solo web) para entender nóminas españolas y llevar finanzas personales. Los PDF se procesan **en memoria** con `pdfjs-dist` al subirlos y se descartan: solo se guarda el texto extraído (`rawText`) y los conceptos estructurados. No hay OCR ni storage de archivos.

## Stack

| Pieza | Tecnología |
|---|---|
| Frontend | Astro 5 (estático) + React 19 + TanStack Query 5 + Tailwind 4 + shadcn/ui (Base UI) + Lucide + Recharts |
| Backend | Express 4 + TypeScript ESM + Drizzle ORM (`drizzle-orm/postgres-js`) + Zod + Pino |
| Base de datos | Postgres en Supabase — `pgTable` de `drizzle-orm/pg-core`, `.enableRLS()` en toda tabla |
| Auth | Supabase Auth con Google; `authMiddleware` verifica el JWT contra el JWKS de Supabase (sin contraseñas ni login propio) |
| Despliegue | Vercel, un proyecto con dos servicios (`vercel.json`) + cron diario `/api/cron/daily` |

## Reglas que más se olvidan

- **Drizzle es asíncrono**: `await db.select()...` devuelve un array → `const [row] = await ...`; insert/update/delete con `.returning()`. `count(*)` con `sql<number>\`count(*)::int\``; búsquedas de texto con `ilike`.
- **Toda query filtra por el dueño** (`userId` de `req.user!`, o vía `profile`/`payslip` → `userId`). Toda ruta nueva que reciba un id se añade a `backend/src/routes/authorization.test.ts`.
- **Helpers obligatorios**: `isoDateSchema` / `monthKeySchema` / `todayIso` (`utils/dates.ts`), `moneySchema` / `positiveMoneySchema` (`utils/validation.ts`), `toCsv` (`utils/csv.ts`), `assertUnderLimit` (`utils/limits.ts`), `validateIdParam` (`middleware/params.ts`).
- **Dinero** en columnas `doublePrecision`; fechas de negocio como texto `YYYY-MM-DD`; `created_at` como `timestamp`.
- **Imports relativos del backend** con extensión `.js`.
- **Frontend**: datos solo con React Query y funciones de `frontend/src/lib/api.ts`; páginas de la app bajo `/app/*`; toasts con `sonner`; nada de manejadores en línea (`onclick="…"`) por la CSP con hashes (`frontend/scripts/csp.mjs`).
- **Secretos**: solo vía `backend/src/config.ts` (validado con Zod); nunca registrar tokens ni cabeceras de auth en logs.
- **Textos visibles para el usuario en español**; código e identificadores en inglés.

## Comandos

```bash
npm run dev           # backend :3001 + frontend :4321 (proxy de /api)
npm run build         # build de backend y frontend (incluye la CSP)
npm run typecheck
npm test              # las de integración necesitan TEST_DATABASE_URL
npm run db:generate   # genera la migración SQL desde schema.ts
npm run db:migrate    # aplica migraciones (falla si una tabla no tiene RLS)
```
