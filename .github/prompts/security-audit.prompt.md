---
name: 'security-audit'
description: 'Auditoría de seguridad OWASP del código actual, enfocada en el stack del proyecto'
agent: 'security-reviewer'
tools:
  - file_search
  - grep_search
  - read_file
  - semantic_search
  - get_errors
---

# /security-audit — Auditoría de Seguridad

Realiza una auditoría de seguridad completa de SueldIA basada en OWASP Top 10, adaptada al stack del proyecto.

## Contexto

Antes de empezar, leer `AGENTS.md`, `backend/AGENTS.md` y `frontend/AGENTS.md`. Puntos clave del stack:
- Postgres en Supabase vía Drizzle (`drizzle-orm/postgres-js`). El backend se conecta como propietario, así que **RLS no aísla a los usuarios en el backend**: eso depende del filtro por `userId` en cada query. RLS (sin políticas) solo cierra la Data API de Supabase.
- Auth con Supabase (Google). No hay contraseñas ni secreto JWT propio: el backend verifica el JWT contra el JWKS de Supabase.
- PDFs procesados en memoria con `pdfjs-dist` y descartados; se guarda `raw_text` (dato personal).
- Frontend Astro estático con CSP por hashes y cabeceras en `vercel.json`.

## Alcance

Analizar sistemáticamente:

### Backend (`backend/src/`)
1. **Autenticación** (`middleware/auth.ts`, `routes/auth.ts`)
   - ¿El JWT se verifica con el JWKS de `SUPABASE_URL`, comprobando `issuer` y `audience: "authenticated"`, y exigiendo `sub` y `email`?
   - ¿Un fallo de BBDD al resolver el usuario da 500 (no 401)?
   - ¿Rate limiting en `/api/auth` y en los endpoints costosos (upload, import, export)?
   - ¿`DELETE /api/auth/me` borra los datos, olvida el usuario cacheado y usa `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor?
   - ¿`/api/cron/daily` exige `CRON_SECRET` con comparación en tiempo constante?

2. **Autorización** (todas las rutas y servicios)
   - ¿Todas las rutas de `/api/*` salvo `/api/auth`, `/api/cron` y `/api/health` se montan con `authMiddleware`?
   - ¿**Cada** select/update/delete filtra por `userId` (o por propiedad vía `profile`/`payslip`, `utils/ownership.ts`)?
   - ¿Los ids recibidos en el body o en lotes se verifican como del usuario?
   - ¿Toda ruta con id está cubierta en `routes/authorization.test.ts`?

3. **Base de datos** (`db/schema.ts`, `db/migrate.ts`)
   - ¿Toda `pgTable` termina en `.enableRLS()`? ¿Sigue el chequeo de `migrate.ts` que falla si una tabla de `public` no tiene RLS?
   - ¿Alguna query usa `sql.raw()` o interpola input del usuario fuera de los parámetros de Drizzle?
   - ¿Los patrones `ilike` con input del usuario escapan `%`/`_` cuando la búsqueda debe ser literal?

4. **Validación de inputs** (todos los archivos en `routes/`)
   - ¿Todos los endpoints validan con Zod (`safeParse`)?
   - ¿Importes con `moneySchema`/`positiveMoneySchema`, fechas con `isoDateSchema`/`monthKeySchema`, ids con `validateIdParam`/`idSchema`, listados con `limit` acotado?
   - ¿Altas con `assertUnderLimit()`?

5. **Uploads y parsing** (`middleware/upload.ts`, `parsers/`)
   - ¿`multer.memoryStorage()` con límite de tamaño y verificación de magic bytes `%PDF`?
   - ¿Nada se escribe en disco? ¿El nombre de archivo se trata como texto no confiable?
   - ¿Un PDF malicioso o enorme puede bloquear la función (páginas, tiempo de `pdfjs-dist`)?

6. **Exportaciones** (`routes/export.ts`, `utils/csv.ts`)
   - ¿Todo CSV pasa por `toCsv()`/`csvCell()` (neutraliza fórmulas `=`, `+`, `-`, `@`)?
   - ¿La exportación completa solo incluye datos del usuario?

7. **Configuración y logs** (`config.ts`, `index.ts`, `logger.ts`, `middleware/cors.ts`, `middleware/error-handler.ts`)
   - ¿Variables de entorno validadas con Zod y ningún secreto hardcodeado?
   - ¿Helmet configurado? ¿CORS limitado al mismo origen + `CORS_ORIGIN`?
   - ¿Stack traces y mensajes internos ocultos en producción?
   - ¿El `redact` de Pino cubre `authorization`, cookies y `set-cookie`? ¿Se registra en algún sitio `raw_text`, importes, cuerpos de petición o tokens (incluido `/api/client-errors`)?

8. **Dependencias**
   - Ejecutar `npm audit` para vulnerabilidades conocidas

### Frontend (`frontend/src/`) y despliegue
9. **Sesión** (`lib/api.ts`, `lib/supabase.ts`, `components/AuthProvider.tsx`)
   - ¿El token se lee siempre de la sesión de Supabase (`getAuthToken()`) y no se copia a `localStorage` propio?
   - ¿Un 401 hace `signOut()` y redirige a `/login`?
   - ¿Solo se usan en el navegador `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`?

10. **XSS y CSP** (componentes, `scripts/csp.mjs`, `vercel.json`)
    - ¿Se usa `dangerouslySetInnerHTML` o se inyecta HTML con datos del usuario (conceptos, notas, nombres de archivo)?
    - ¿La CSP sigue sin `'unsafe-inline'` en `script-src`, con hashes por script y rechazo de manejadores en línea? ¿Hay dominios nuevos en `connect-src`/`img-src` sin justificar?
    - ¿Las cabeceras de `vercel.json` (HSTS, `frame-ancestors`, `Permissions-Policy`…) siguen presentes?
    - ¿El service worker (`public/sw.js`) no cachea `/api` ni páginas de la app?

## Formato del Reporte

```markdown
# 🔒 Auditoría de Seguridad — SueldIA

**Fecha**: [fecha]
**Alcance**: [archivos analizados]

## Resumen Ejecutivo
- 🔴 Críticos: [N]
- 🟡 Medios: [N]
- 🟢 Bajos: [N]
- ✅ Buenas prácticas detectadas: [N]

## Hallazgos

### 🔴 [CRÍTICO] Título
**Archivo**: ruta:línea
**Descripción**: ...
**Impacto**: ...
**Remediación**: ...

## Buenas Prácticas Detectadas
- ✅ [práctica positiva encontrada]

## Recomendaciones Generales
- [mejoras sugeridas no urgentes]
```
