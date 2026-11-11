---
name: 'TypeScript Standards'
description: 'Convenciones de TypeScript para todo el proyecto SueldIA'
applyTo: '**/*.ts,**/*.tsx'
---

# Convenciones TypeScript — SueldIA

## Módulos ESM
- Usar `import`/`export` — nunca `require()`/`module.exports`
- En el **backend**, los imports relativos DEBEN usar extensión `.js` (compatibilidad ESM build):
  ```typescript
  import { db } from '../db/index.js';     // ✅ correcto
  import { db } from '../db/index';        // ❌ falla en runtime
  ```
- En el **frontend** (Astro/Vite), NO usar extensión en imports — el bundler resuelve automáticamente

## Tipado
- **Strict mode** habilitado — nunca usar `any`, preferir `unknown` cuando el tipo es incierto
- Interfaces para shapes de datos y API payloads (extensibles)
- Type aliases para uniones y tipos utilitarios
- Type assertions (`as Type`) solo cuando sea estrictamente necesario
- Genéricos cuando aporten reutilización real, no por complejidad innecesaria

## Naming
- `camelCase` para variables, funciones, métodos, parámetros
- `PascalCase` para interfaces, tipos, clases, componentes React, enums
- `UPPER_SNAKE_CASE` para constantes invariantes
- Prefijo `I` NO se usa para interfaces — usar nombre descriptivo directo
- Sufijos descriptivos: `Router`, `Schema`, `Provider`, `Context`, `Middleware`

## Exports
- **Named exports** por defecto en todo el proyecto
- **Default exports** solo para componentes React de página (el wrapper con Providers)
- Un archivo = un dominio cohesivo. No crear archivos barrel nuevos (`index.ts` que solo re-exportan); la excepción existente es `frontend/src/components/app/index.ts` (sistema de diseño)

## Error Handling
- Backend: `try/catch` + `next(err)` en handlers async; errores operacionales con `AppError` (`middleware/error-handler.ts`)
- Backend: las queries de Drizzle (`postgres-js`) son asíncronas — siempre `await`, y desestructurar la fila: `const [row] = await db.select()...`
- Frontend: React Query maneja errores automáticamente vía `error` state
- Nunca silenciar errores con `catch` vacíos
- Usar tipos discriminados para resultados: `{ success: true, data } | { success: false, error }`

## Zod
- Definir schemas junto a la ruta que los usa (no en archivo separado)
- Usar `.safeParse()` para inputs del usuario (devuelve resultado, no lanza excepción)
- Schemas reutilizables: exportar solo si se usan en más de un lugar
- Reutilizar los compartidos en vez de redefinirlos: `isoDateSchema`/`monthKeySchema` (`backend/src/utils/dates.ts`), `moneySchema`/`positiveMoneySchema`/`idSchema` (`backend/src/utils/validation.ts`)
- Variables de entorno solo vía `backend/src/config.ts` (validadas con Zod) — nunca `process.env` suelto en el código de la app (salvo las variables de plataforma `VERCEL`/`VERCEL_ENV`)
