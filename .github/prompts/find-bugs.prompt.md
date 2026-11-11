---
name: 'find-bugs'
description: 'Escanea el código en busca de bugs potenciales, errores lógicos y problemas de robustez'
agent: 'agent'
tools:
  - file_search
  - grep_search
  - read_file
  - semantic_search
  - get_errors
---

# /find-bugs — Detector de Bugs

Escanea el codebase de SueldIA buscando bugs potenciales, errores lógicos y problemas de robustez.

## Proceso

### 1. Errores de Compilación
Primero, verificar si hay errores de TypeScript usando la herramienta de diagnóstico.

### 2. Backend — Bugs Comunes
Buscar en `backend/src/`:

- **Async/Await**: handlers sin `try/catch` o sin `await` en llamadas async
- **Error propagation**: handlers que no llaman `next(err)` en el catch
- **Null/undefined**: acceso a propiedades sin verificar existencia (`const [row] = await db.select()...` deja `row` como `undefined` si no hay filas)
- **Drizzle síncrono**: restos de la API de SQLite (`.get()`, `.all()`, `.run()`) o queries sin `await` — con `postgres-js` todo es asíncrono
- **Validación faltante**: endpoints que aceptan input sin validar con Zod
- **SQL queries**: uso de `sql.raw()` o interpolación insegura de variables; `count(*)` sin `::int` (llega como string); `like` donde debería ser `ilike`
- **Ownership**: queries (sobre todo `update`/`delete`) que no filtran por `userId` del usuario autenticado, o ids del body sin verificar que son suyos
- **Fechas e importes**: regex sueltas o `new Date().toISOString()` para "hoy" en vez de `isoDateSchema`/`monthKeySchema`/`todayIso()`; importes con `z.number()` sin `moneySchema` (acepta `Infinity`); columnas de dinero `numeric` en vez de `doublePrecision`
- **Race conditions**: operaciones async que asumen estado no cambia entre reads
- **Parser de PDFs**: PDFs que no abren o devuelven texto vacío sin acabar en status `error`/`review`; regex del `concept-matcher` que fallan con decimales/miles en formato español
- **Type coercion**: comparaciones y operaciones con tipos mixtos (string vs number)
- **Missing status codes**: respuestas sin código de estado explícito
- **Serverless**: trabajo lanzado tras responder (`res.json()` y luego `await`), que en Vercel puede no terminar nunca
- **Memory leaks**: event listeners, cachés en memoria sin límite o timers no limpiados

### 3. Frontend — Bugs Comunes
Buscar en `frontend/src/`:

- **Missing loading/error states**: queries sin manejar `isLoading` o `error`
- **Stale closures**: callbacks en useEffect que capturan state obsoleto
- **Missing dependencies**: useEffect/useMemo/useCallback con deps incompletas
- **Uncontrolled inputs**: forms sin estado controlado
- **Memory leaks**: subscriptions o timers sin cleanup en useEffect
- **Key props**: listas renderizadas sin `key` o con index como key
- **Auth token**: `fetch()` fuera de `lib/api.ts` que no adjunta el token de Supabase (`await getAuthToken()`) o no maneja el 401
- **Enlaces internos**: rutas sin el prefijo `/app/...`
- **CSP**: manejadores en línea (`onclick="…"`) en `.astro`/HTML, que rompen el build
- **Type mismatches**: datos de API usados sin verificar el tipo

### 4. Cross-cutting
- **Inconsistencias API**: frontend espera un shape diferente al que devuelve el backend
- **Environment leaks**: variables de entorno o secretos hardcodeados
- **Import paths**: imports incorrectos (falta extensión `.js` en backend)
- **Cobertura de autorización**: rutas con id que no están en `backend/src/routes/authorization.test.ts`

## Formato del Reporte

Para cada bug encontrado:

```markdown
### 🔴 CRÍTICO / 🟡 MEDIO / 🟢 BAJO — [Descripción breve]

**Archivo**: [ruta:línea]
**Tipo**: [categoría del bug]
**Problema**: [descripción detallada]
**Ejemplo**: [código problemático]
**Fix sugerido**: [cómo corregirlo]
```

Ordenar por severidad (críticos primero). Incluir conteo total al final.
