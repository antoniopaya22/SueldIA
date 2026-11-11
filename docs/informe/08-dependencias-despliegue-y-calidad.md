# 08 · Dependencias, despliegue, pruebas y documentación

Todo lo de este fichero está comprobado sobre el repositorio el 11-11-2026 (`npm audit`, `vitest`, lectura de configuración).

## 1. Dependencias con vulnerabilidades conocidas

`npm audit --omit=dev` en la raíz del monorepo: **29 avisos (3 críticos, 18 altos, 6 moderados, 2 bajos)**.

### 1.1. Las que afectan a producción

| Paquete | Instalado | Gravedad | Dónde corre | Qué hacer |
|---|---|---|---|---|
| `express` 4 y sus transitivas: `body-parser`, `qs`, `path-to-regexp`, `proxy-addr` (crítica) | `^4.21.2` | crítica / alta | Backend, en cada petición | `npm audit fix` las resuelve sin cambio de versión mayor. `proxy-addr` importa especialmente porque la app usa `trust proxy` (`backend/src/index.ts:40`) y de ahí sale la IP para el rate limit |
| `express-rate-limit` | `^8.3.0` | moderada | Backend | `npm audit fix` |
| `drizzle-orm` | `^0.38.4` | alta | Backend, todas las consultas | Subir a `>=0.45.2`. Es salto de varias versiones menores: leer el changelog y regenerar una migración de prueba para confirmar que `drizzle-kit` no propone cambios inesperados |
| `pdfjs-dist` | `^3.11.174` | alta | Backend, al subir cada PDF | Ver 1.2 |
| `zod` | `^3.24.2` | alta (agotamiento de memoria al validar colecciones enormes) | Backend, validación de toda entrada | La corrección está en zod 4 (cambio mayor). Mitigación inmediata: el `express.json()` ya limita el cuerpo a 100 kB por defecto, lo que acota el tamaño de cualquier colección. Planificar la migración a zod 4 |
| `multer` | `^1.4.5-lts.1` | — (no sale en el audit, pero la rama 1.x está abandonada) | Backend, subidas | Migrar a `multer` 2.x; la API es casi idéntica |
| `json2csv` | `^6.0.0-alpha.2` | — | No se usa | Figura en `package.json` pero ningún fichero lo importa (la exportación escribe el CSV a mano). Eliminarlo |

### 1.2. `pdfjs-dist` 3.x

El aviso (`pdfjs-dist <=4.1.392`) es la ejecución de código arbitrario al procesar un PDF malicioso (fuentes manipuladas). El camino vulnerable está en el dibujado de glifos; SueldIA solo llama a `getTextContent()` (`backend/src/parsers/pdf-text-extractor.ts:96`), así que **probablemente** no se alcanza, pero no lo he demostrado. Dos medidas:

1. **Hoy** (una línea): pasar `isEvalSupported: false` a `getDocument` en `pdf-text-extractor.ts:89`. Es la mitigación oficial y no cambia el resultado de la extracción.
2. **Después**: subir a pdfjs-dist 4.x/5.x. Cambia el punto de entrada (`legacy/build/pdf.mjs`, ESM) y hay que revisar el truco de `workerSrc` para Vercel (líneas 8-13). Los tests de `concept-matcher` sirven de red de seguridad para el texto ya extraído; para el extractor en sí hace falta probar con PDF reales.

Recuerda que el PDF lo sube un usuario autenticado cualquiera, así que es entrada no confiable ejecutándose en el mismo proceso que tiene `DATABASE_URL`.

### 1.3. Las que solo afectan a desarrollo o al build

`astro` (crítica), `vite`, `sharp`, `esbuild`, `postcss`, `tar`, `undici`, `shadcn` y su árbol (`@modelcontextprotocol/sdk`, `ts-morph`, `systeminformation`…). El sitio es estático: en producción no corre ni Astro ni Vite. Aun así:

- `astro` 5 → 7 es la corrección propuesta. Es un salto grande; planificarlo, no urgente.
- `vite`: los avisos son del servidor de desarrollo. Riesgo solo si se expone `astro dev` a la red.
- `shadcn` está en `dependencies` del frontend porque `global.css:3` importa `shadcn/tailwind.css`. Arrastra el CLI entero (y media docena de avisos). Opciones: copiar ese CSS al repositorio y mover `shadcn` a `devDependencies`, o dejarlo y asumir el ruido en el audit.

### 1.4. Proceso

- `npm audit fix` (sin `--force`) ahora mismo: resuelve la mayoría de transitivas sin riesgo. Después, `npm test` y `npm run build`.
- Activar **Dependabot** o **Renovate** (agrupando parches semanales). Hoy no hay ningún mecanismo que avise.
- Añadir `"engines": { "node": ">=22" }` en el `package.json` raíz y fijar la versión de Node en Vercel, para que local y producción no diverjan.

## 2. Integración continua: no hay

No existe `.github/workflows/`. El repositorio tiene 23 ficheros de test con 149 pruebas que pasan en 2,3 s, y un script `typecheck`, pero nada los ejecuta automáticamente: un PR puede fusionarse con tests rotos y Vercel lo desplegará.

Flujo mínimo propuesto (`.github/workflows/ci.yml`), en cada PR y en `main`:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm audit --omit=dev --audit-level=high` (puede empezar como aviso no bloqueante)

Y en GitHub: proteger `main` exigiendo que el flujo pase.

Lo que falta además:

- **Linter y formateador.** No hay ESLint, Biome ni Prettier. Con ficheros de 1.000-1.600 líneas, reglas como `react-hooks/exhaustive-deps` y `no-floating-promises` encuentran errores reales.
- **Tests de frontend: cero.** Hay lógica pura fácil de probar sin navegador en `frontend/src/lib/` (`analytics-charts.ts`, `analytics-compare.ts`, `budget-progress.ts`, `transaction-filters.ts`, `reorder.ts`, `format.ts`). Añadir Vitest al workspace del frontend cuesta poco.
- **Tests de rutas: cero.** Los tests actuales cubren servicios y parsers, pero no hay ninguno que levante Express y compruebe autorización. Un conjunto pequeño con `supertest` y dos usuarios («A no puede leer/editar/borrar nada de B» por cada recurso) es la prueba más valiosa que le falta al proyecto; es exactamente la clase de error que no se ve a simple vista.
- **Tests extremo a extremo.** Un recorrido con Playwright (login simulado → subir nómina → verla en el panel → crear transacción → presupuesto) detectaría roturas entre islas de Astro.
- **Nóminas reales anonimizadas como fixtures.** `examples/` está en `.gitignore`. El parser es regex sobre formatos concretos; cada formato nuevo que se soporte debería entrar con su fixture.

## 3. Despliegue (Vercel)

| # | Observación | Evidencia | Propuesta |
|---|---|---|---|
| 3.1 | Las migraciones se ejecutan como `buildCommand` del backend contra la única base de datos | `vercel.json:7`, `backend/src/db/migrate.ts` | Funciona, y ya se salta en previews. Riesgos que quedan: (a) si la migración se aplica y el build del frontend falla después, queda esquema nuevo con código viejo; (b) dos despliegues simultáneos migran a la vez. Mitigar escribiendo siempre migraciones compatibles hacia atrás (añadir antes de quitar, en dos despliegues) y dejarlo escrito como regla |
| 3.2 | No hay entorno de preproducción con datos propios | `migrate.ts:8-12` lo reconoce | Un segundo proyecto de Supabase (plan gratuito) para previews: permitiría probar migraciones antes de producción |
| 3.3 | El cron diario procesa **todos** los usuarios en una sola petición | `backend/src/routes/cron.ts:32-35` | Con pocos usuarios va bien; crecerá hasta el límite de duración de la función. Declarar `maxDuration` explícito, procesar por lotes y registrar cuánto tarda. Ver `03` |
| 3.4 | El secreto del cron se compara con `!==` | `cron.ts:28` | Usar `crypto.timingSafeEqual`. Riesgo bajo, corrección trivial |
| 3.5 | Sin cabeceras de seguridad en el frontend estático | `vercel.json` no tiene bloque `headers`; `helmet` solo cubre `/api` y con CSP desactivada (`index.ts:44-48`) | Añadir en `vercel.json` para todas las rutas: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (o `frame-ancestors 'none'`), `Permissions-Policy` restrictiva y una **Content-Security-Policy** (`default-src 'self'`; `connect-src 'self' https://<ref>.supabase.co`; `img-src 'self' data: https://*.googleusercontent.com`; scripts propios). La CSP es lo que limita el daño si algún día se cuela un XSS, y aquí el token de sesión vive en `localStorage` |
| 3.6 | Límite de peticiones en memoria por instancia | `index.ts:55-68` (el propio comentario lo explica) | Aceptable hoy. Si la app se abre a más gente: Upstash Redis o el firewall de Vercel. La subida de PDF merece un límite propio más bajo (es la operación cara) |
| 3.7 | `uncaughtException` y `unhandledRejection` se registran y se ignoran | `index.ts:131-137` | Tras una excepción no capturada el proceso queda en estado indefinido. En serverless lo razonable es registrar y dejar morir la instancia (`process.exit(1)`); Vercel levanta otra |
| 3.8 | Sin monitorización de errores ni alertas | Solo `pino` a stdout | Sentry (o similar) en backend y frontend; alerta si `/api/health` falla o el cron no responde 200. Hoy un fallo del cron diario pasa inadvertido |
| 3.9 | `/api/health` hace una consulta a la base de datos y es público | `index.ts:79-86` | Está fuera del `authLimiter` pero dentro del global. Suficiente; solo vigilar que nadie lo use para mantener despierta la base de datos a tu costa |
| 3.10 | Región `dub1` | `vercel.json:27` | Comprobar que el proyecto de Supabase está en la misma zona (eu-west-1). Si no, cada consulta paga latencia entre regiones |

## 4. Base de datos: copias y recuperación

- La app no guarda los PDF. Si se pierde la base de datos, se pierde todo y el usuario tendría que volver a subir sus nóminas. Confirmar qué retención de copias da tu plan de Supabase y probar **una** restauración.
- Ofrecer al usuario una **exportación completa** de sus datos (JSON o ZIP de CSV): sirve como copia personal y cubre el derecho de portabilidad del RGPD. Ver `06-nuevas-funcionalidades.md`.

## 5. Documentación desfasada

| Fichero | Problema | Evidencia |
|---|---|---|
| `README.md` | Describe la versión retirada: SQLite, OCR con Tesseract, `JWT_SECRET`, `spa.traineddata` | líneas 1-25 |
| `.env.example` | Habla de `/api/cron/evaluate-alerts`; la ruta real es `/api/cron/daily` | línea 26 |
| `backend/src/config.ts` | Mismo nombre de ruta antiguo en el comentario | línea 18 |
| `backend/src/index.ts` | Remite a `api/index.ts`, que ya no existe | línea 115 |
| `AGENTS.md` (raíz) | La tabla de tablas lista 9; el esquema tiene 18 (faltan todas las de finanzas) | sección «Tablas de Base de Datos» |
| `backend/AGENTS.md` | La lista de tablas omite `budgets`, `category_targets`, `category_rules`, `user_preferences` | sección «Schema de Base de Datos» |
| `.gitignore` | Entradas de Electron, OCR y `data/` que ya no aplican | líneas 11, 21-22, 32-34 |
| `.github/` | Instrucciones de agentes para Copilot que duplican `AGENTS.md`; verificar que no contradicen el stack actual | `.github/agents`, `.github/instructions`, `.github/prompts` |

Un README correcto debería explicar: qué es SueldIA, arquitectura en un diagrama, cómo arrancar en local (Postgres local o proyecto de Supabase, variables, `npm run db:migrate`, `npm run dev`), cómo desplegar y cómo añadir un formato de nómina al parser.

## 6. Limpieza del repositorio

- **`old/`**: 113 ficheros y 1,2 MB de la versión Electron/SQLite/OCR, declarada «no se mantiene». Sigue en el historial de git aunque se borre. Eliminarla quita ruido en búsquedas, en el audit y para los agentes de IA; como alternativa, una etiqueta `v1-desktop` en el último commit que la contenía.
- **Nombre del paquete y versiones**: `package.json` dice `1.0.0`, `/api/health` responde `2.0.0`. Unificar, o exponer el SHA del commit (`VERCEL_GIT_COMMIT_SHA`), que es más útil para depurar.
- **Sin `LICENSE`**. Si el repositorio es público, decidir licencia.

## 7. Observabilidad del producto

No hay ninguna métrica de uso. Sin necesidad de analítica invasiva, tres contadores en los logs ya responderían a preguntas importantes:

- Porcentaje de nóminas que acaban en `parsed`, `review` y `error` (calidad real del parser, por formato detectado).
- Tiempo de extracción por PDF (hay un límite de 10 s en `parser-engine.ts`; ¿cuántas veces se alcanza?).
- Duración y resultado del cron diario.
