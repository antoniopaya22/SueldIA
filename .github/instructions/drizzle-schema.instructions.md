---
name: 'Drizzle Schema'
description: 'Convenciones para schema de base de datos Drizzle ORM (Postgres/Supabase) y migraciones'
applyTo: 'backend/src/db/**'
---

# Schema Drizzle ORM — Base de Datos

Postgres en Supabase con `drizzle-orm/pg-core` (schema) y `drizzle-orm/postgres-js` (queries). Fuente de verdad: [`backend/AGENTS.md`](../../backend/AGENTS.md).

## Convenciones de Naming SQL

- **Tablas**: `snake_case`, plural (`payslip_concepts`, `alert_rules`)
- **Columnas**: `snake_case` (`created_at`, `supabase_user_id`, `period_month`); propiedad TS en `camelCase`
- **Foreign keys**: `nombre_referencia_id` (`profile_id`, `payslip_id`, `rule_id`)
- **Índices**: `<tabla>_<columna(s)>_idx`

## Definición de Tablas

Usar helpers de `drizzle-orm/pg-core`. **Toda tabla termina en `.enableRLS()`** — `npm run db:migrate` falla si alguna tabla de `public` queda sin RLS:

```typescript
import { pgTable, text, integer, serial, boolean, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';

export const savingsGoals = pgTable(
  'savings_goals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmount: doublePrecision('target_amount').notNull(),
    kind: text('kind', { enum: ['monthly', 'by_date'] }).notNull().default('monthly'),
    dueDate: text('due_date'),                                  // "YYYY-MM-DD"
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('savings_goals_user_idx').on(table.userId),
  }),
).enableRLS();
```

## Patrones de Columnas

| Tipo lógico | Tipo Postgres (Drizzle) | Ejemplo |
|---|---|---|
| PK | `serial('id').primaryKey()` | id |
| String | `text('col').notNull()` | name, email, company |
| Entero | `integer('col')` | period_month, sort_order |
| Dinero | `doublePrecision('col')` — **nunca `numeric`** (llega como string y rompe las sumas) | gross_salary, amount |
| Boolean | `boolean('col').notNull().default(false)` | enabled, read, archived |
| Enum | `text('col', { enum: [...] }).notNull()` | status, category, severity |
| Timestamp | `timestamp('col', { withTimezone: true }).notNull().defaultNow()` | created_at |
| Fecha de negocio | `text('col')` con `YYYY-MM-DD` / `YYYY-MM` | date, month |
| JSON | `text('col').notNull().default('{}')` (patrón actual de `alert_rules.config`) | config |

## Foreign Keys

Siempre definir ON DELETE para integridad referencial, y un índice si la FK se consulta o se borra en cascada (sin índice, Postgres recorre la tabla hija entera):

```typescript
profileId: integer('profile_id')
  .notNull()
  .references(() => profiles.id, { onDelete: 'cascade' }),  // eliminar hijos con el padre

ruleId: integer('rule_id').references(() => alertRules.id, {
  onDelete: 'set null',  // mantener registro pero limpiar referencia
}),
```

Las tablas de primer nivel llevan `user_id` (FK a `users`, `cascade`) para poder filtrar por dueño en cada query.

## Workflow de Migraciones

1. Modificar `backend/src/db/schema.ts` con los cambios
2. Generar migration SQL (drizzle-kit, `dialect: 'postgresql'`):
   ```bash
   npm run db:generate
   ```
3. Revisar el SQL generado en `backend/src/db/migrations/` (que incluya `ENABLE ROW LEVEL SECURITY` para tablas nuevas; sin `DROP` inesperados)
4. Aplicar migración (con `DATABASE_URL` exportada):
   ```bash
   npm run db:migrate
   ```

En Vercel las migraciones se aplican en el build del backend solo en producción: deben ser compatibles con la versión anterior del código (primero añadir, en otro despliegue quitar).

## Conexión a Base de Datos

Singleton en `backend/src/db/index.ts`:
```typescript
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { env } from '../config.js';

// prepare: false — necesario contra el Transaction Pooler de Supabase (puerto 6543)
const client = postgres(env.DATABASE_URL, { prepare: false });

export { client };
export const db = drizzle(client, { schema });
```

## Queries Comunes

Todas asíncronas; los `select` devuelven arrays. Nada de `.get()`/`.all()`/`.run()`.

```typescript
import { and, eq, ilike, desc, sql } from 'drizzle-orm';

// Select con filtro por dueño
const rows = await db.select().from(profiles).where(eq(profiles.userId, userId));

// Una fila
const [profile] = await db
  .select()
  .from(profiles)
  .where(and(eq(profiles.id, id), eq(profiles.userId, userId)));

// Join filtrando por dueño a través del perfil
const list = await db
  .select({ id: payslips.id, company: payslips.company, profileName: profiles.name })
  .from(payslips)
  .innerJoin(profiles, eq(payslips.profileId, profiles.id))
  .where(eq(profiles.userId, userId))
  .orderBy(desc(payslips.periodYear), desc(payslips.periodMonth));

// Agregaciones: count(*) con ::int
const [{ total }] = await db
  .select({ total: sql<number>`count(*)::int` })
  .from(payslips)
  .innerJoin(profiles, eq(payslips.profileId, profiles.id))
  .where(eq(profiles.userId, userId));

// Raw SQL en select (parametrizado)
const [{ avg }] = await db
  .select({ avg: sql<number | null>`avg(${payslips.netSalary})` })
  .from(payslips)
  .where(eq(payslips.profileId, profileId));

// Búsqueda de texto
const found = await db
  .select()
  .from(profiles)
  .where(and(eq(profiles.userId, userId), ilike(profiles.name, `%${q}%`)));
```
