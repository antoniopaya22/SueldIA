# SueldIA

Aplicación web para entender tus nóminas españolas y llevar tus finanzas personales en el mismo sitio.

- **Nóminas**: subes el PDF y SueldIA extrae periodo, empresa, bruto, neto y cada concepto (devengos y deducciones). Panel, analítica (evolución, IRPF, interanual, anomalías) y alertas configurables.
- **Finanzas**: cuentas, transacciones (traspasos, gastos divididos, recurrentes), presupuesto por categorías al estilo YNAB, reglas de categorización, informe mensual, previsión y analítica. Importación desde YNAB.

Los PDF **no se guardan**: se procesan en memoria al subirlos y solo se conserva el texto extraído y los datos estructurados.

## Arquitectura

```
Navegador ──▶ Astro estático + islas React ──▶ /api/* (rewrite de Vercel) ──▶ Express ──▶ Postgres (Supabase)
                     │
                     └──▶ Supabase Auth (login con Google)
```

| Pieza | Tecnología | Dónde |
|---|---|---|
| Frontend | Astro 5 (salida estática) + React 19 + TanStack Query + Tailwind 4 + shadcn/ui (Base UI) | `frontend/` |
| Backend | Express 4 + Drizzle ORM + Zod + Pino | `backend/` |
| Base de datos | Postgres en Supabase (RLS activado en todas las tablas; la app no usa la Data API) | `backend/src/db/` |
| Autenticación | Supabase Auth con Google; el backend verifica el JWT contra el JWKS de Supabase | `backend/src/middleware/auth.ts` |
| Despliegue | Un proyecto de Vercel con dos servicios (`vercel.json`) y un cron diario | raíz |

Guías para agentes de IA y convenciones del código: `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`.

## Desarrollo local

Requisitos: Node 22 o superior y un Postgres (local con Docker, o un proyecto de Supabase de pruebas).

```bash
npm install

# Variables de entorno (backend y frontend comparten fichero)
cp .env.example .env.local
# Edita .env.local: DATABASE_URL, SUPABASE_URL, PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY

# Postgres local (opcional)
docker run -d --name sueldia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sueldia -p 5432:5432 postgres:16-alpine

# El backend lee las variables del entorno (no usa dotenv): expórtalas antes
set -a; source .env.local; set +a

npm run db:migrate   # aplica backend/src/db/migrations
npm run dev          # backend en :3001 y frontend en :4321 (con proxy de /api)
```

El login necesita un proyecto de Supabase con el proveedor de Google configurado y `http://localhost:4321/login` en las URL de redirección.

## Pruebas

```bash
npm test             # backend y frontend; las de integración se saltan sin BBDD
npm run typecheck
npm run build
```

Las pruebas de integración (autorización entre usuarios, borrados con reasignación…) necesitan un Postgres **de pruebas**, porque vacían las tablas:

```bash
docker run -d --name sueldia-pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sueldia_test -p 55432:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/sueldia_test
DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate
npm test
```

La integración continua (`.github/workflows/ci.yml`) hace todo esto en cada PR.

## Base de datos y migraciones

- El esquema está en `backend/src/db/schema.ts`. Tras cambiarlo: `npm run db:generate` y revisar el SQL generado.
- Toda tabla nueva lleva `.enableRLS()`: `db:migrate` falla si alguna tabla de `public` queda sin RLS.
- En Vercel, las migraciones se aplican en el build del servicio backend, **solo** en producción (los previews se las saltan). Escribe migraciones compatibles con la versión anterior del código: primero añadir, en otro despliegue quitar.

## Despliegue

`vercel.json` define dos servicios (`backend` con Express, `frontend` con Astro), las rutas, las cabeceras de seguridad y el cron diario (`/api/cron/daily`: recurrentes y alertas). Variables necesarias en Vercel: las de `.env.example` (`CRON_SECRET` para el cron; `SUPABASE_SERVICE_ROLE_KEY` para que eliminar la cuenta borre también el acceso de Google).

## Añadir un formato de nómina

El analizador está en `backend/src/parsers/`: `pdf-text-extractor.ts` reconstruye el texto por filas y columnas y `concept-matcher.ts` aplica las reglas de cada formato. Para un formato nuevo, añade su detección y su extracción con una nómina anonimizada como prueba en `concept-matcher.test.ts`.
