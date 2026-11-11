---
name: 'db-migration'
description: 'Guía paso a paso para crear una nueva migración Drizzle ORM'
agent: 'db-admin'
tools:
  - run_in_terminal
  - file_search
  - grep_search
  - read_file
  - create_file
  - replace_string_in_file
  - get_errors
---

# /db-migration — Nueva Migración de Base de Datos

Guía interactiva para crear cambios en la base de datos de SueldIA (Postgres en Supabase) usando Drizzle ORM y drizzle-kit.

## Input del Usuario

El usuario debe describir qué cambio necesita en la base de datos:
- **Nueva tabla**: nombre, columnas, relaciones
- **Modificar tabla**: qué columnas añadir/cambiar
- **Nuevo índice**: qué columnas indexar
- **Nueva relación**: entre qué tablas

Si el input es vago, preguntar detalles específicos.

## Proceso

### Paso 1: Revisar Estado Actual

Leer `backend/src/db/schema.ts` para entender las tablas existentes y sus relaciones.

### Paso 2: Modificar Schema

Editar `backend/src/db/schema.ts` siguiendo las convenciones:

- `pgTable` de `drizzle-orm/pg-core`; tablas y columnas en `snake_case`
- **Toda tabla nueva termina en `.enableRLS()`** (si no, `db:migrate` falla)
- PKs con `serial('id').primaryKey()`
- Dinero con `doublePrecision` (nunca `numeric`)
- Booleans con `boolean('col').notNull().default(false)`
- Enums con `text('col', { enum: [...] })`
- `created_at` con `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`
- Fechas de negocio como `text` (`YYYY-MM-DD` / `YYYY-MM`)
- Foreign keys con `onDelete` explícito y su `index(...)`; tablas de primer nivel con `user_id` → `users` (`cascade`)

Ver [Drizzle Schema](../instructions/drizzle-schema.instructions.md) para un ejemplo completo.

### Paso 3: Generar Migración

```bash
npm run db:generate
```

Esto genera un archivo SQL en `backend/src/db/migrations/`.

### Paso 4: Revisar Migración Generada

Leer el archivo SQL generado para verificar que:
- Las sentencias SQL son correctas
- Las tablas nuevas incluyen `ENABLE ROW LEVEL SECURITY`
- No hay cambios destructivos inesperados (DROP TABLE, DROP COLUMN)
- Los defaults y constraints son correctos (un `NOT NULL` nuevo sobre una tabla con datos necesita `default` o backfill)

### Paso 5: Aplicar Migración

Con `DATABASE_URL` exportada (`set -a; source .env.local; set +a`), contra la BBDD local o de pruebas — nunca a mano contra producción:

```bash
npm run db:migrate
```

En Vercel las migraciones se aplican solas en el build del backend, solo en producción.

### Paso 6: Verificar

Confirmar que:
- La migración se aplicó sin errores
- El schema refleja los cambios esperados
- Las rutas existentes siguen funcionando (`npm run build` y `npm test`, con `TEST_DATABASE_URL` para las de integración)
- Si la tabla es nueva y tiene rutas con id, sus casos están en `backend/src/routes/authorization.test.ts`

## Consideraciones Postgres / Supabase

- Despliegue sin downtime: el código anterior sigue corriendo mientras se aplica la migración. Primero añadir (columna nullable o con default), en otro despliegue quitar o renombrar
- `ALTER TABLE ... ADD COLUMN ... NOT NULL` sin `DEFAULT` falla si la tabla tiene filas
- Cambiar el tipo de una columna puede necesitar `USING` — revisar el SQL que genera drizzle-kit
- Toda FK nueva lleva su índice (sin él, los borrados en cascada recorren la tabla hija entera)
- RLS sin políticas es intencionado: el backend se conecta como propietario y la Data API de Supabase queda cerrada
