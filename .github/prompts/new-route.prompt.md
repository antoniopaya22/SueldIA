---
name: 'new-route'
description: 'Scaffolding completo de una nueva ruta Express con validación Zod, CRUD handlers y registro'
agent: 'backend-dev'
tools:
  - run_in_terminal
  - file_search
  - grep_search
  - read_file
  - create_file
  - replace_string_in_file
  - get_errors
---

# /new-route — Scaffolding de Ruta Express

Crea una nueva ruta Express completa siguiendo los patrones exactos de SueldIA.

## Input del Usuario

El usuario debe especificar:
- **Nombre del recurso** (ej: "categories", "reports", "templates")
- **Campos** del recurso (ej: "name: string, description: string optional, priority: number")
- **Si es protegida** (por defecto: sí)

Si el usuario no proporciona suficiente detalle, preguntar lo necesario.

## Proceso de Generación

### 1. Crear tabla en schema (si no existe)

Añadir la tabla en `backend/src/db/schema.ts` siguiendo el patrón existente (`pgTable` de `drizzle-orm/pg-core`, ver [Drizzle Schema](../instructions/drizzle-schema.instructions.md)):

```typescript
export const resources = pgTable(
  'resources',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // campos del recurso en snake_case (dinero: doublePrecision; fechas de negocio: text YYYY-MM-DD)
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('resources_user_idx').on(table.userId),
  }),
).enableRLS();
```

Añadir su tope por usuario a `USER_LIMITS` en `backend/src/utils/limits.ts` (p. ej. `resources: 200`) — el ejemplo de ruta lo usa en el alta.

### 2. Crear archivo de ruta

Crear `backend/src/routes/resources.ts` siguiendo [Backend Routes](../instructions/backend-routes.instructions.md) y `backend/src/routes/accounts.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resources } from '../db/schema.js';
import { validateIdParam } from '../middleware/params.js';
import { assertUnderLimit, USER_LIMITS } from '../utils/limits.js';

export const resourcesRouter = Router();
resourcesRouter.param('id', validateIdParam);

// Schema de validación (fechas: isoDateSchema; importes: moneySchema)
const createSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
});
const updateSchema = createSchema.partial();

// GET / — Listar (siempre filtrando por userId)
resourcesRouter.get('/', async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const data = await db
      .select()
      .from(resources)
      .where(eq(resources.userId, userId))
      .orderBy(desc(resources.createdAt));
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST / — Crear
resourcesRouter.post('/', async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors });
    }
    await assertUnderLimit(resources, resources.userId, userId, USER_LIMITS.resources, 'recursos');
    const [created] = await db.insert(resources).values({ ...parsed.data, userId }).returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /:id, PUT /:id (updateSchema), DELETE /:id — mismo patrón:
// `const [row] = await db...where(and(eq(resources.id, id), eq(resources.userId, userId))).returning();`
// y 404 si `row` es undefined (inexistente o de otro usuario).
```

### 3. Registrar en index.ts

Añadir en `backend/src/index.ts`, detrás de `authMiddleware`:
```typescript
import { resourcesRouter } from './routes/resources.js';
// En la sección de rutas protegidas:
app.use('/api/resources', authMiddleware, resourcesRouter);
```

### 4. Generar migración

```bash
npm run db:generate
```

Revisar el SQL generado (debe incluir `ENABLE ROW LEVEL SECURITY`).

### 5. Añadir los casos de autorización

Añadir a `backend/src/routes/authorization.test.ts` un recurso del usuario A y los ataques del usuario B (`GET`/`PUT`/`DELETE /resources/:id` y cualquier id que se acepte en el body), y el listado a la comprobación de listados sin fugas.

### 6. Crear funciones API en frontend

Añadir en `frontend/src/lib/api.ts` (ver [API Client](../instructions/api-client.instructions.md)):
```typescript
export interface Resource { id: number; name: string; createdAt: string }

export const getResources = () =>
  request<{ data: Resource[] }>('/resources').then((r) => r.data);

export const createResource = (data: { name: string }) =>
  request<Resource>('/resources', { method: 'POST', body: JSON.stringify(data) });
```

## Verificación Final

1. Compilar backend: `npm run build --workspace=backend`
2. Verificar que la migración se generó correctamente
3. Confirmar que la ruta está registrada en index.ts con `authMiddleware`
4. Ejecutar `npm test --workspace=backend` con `TEST_DATABASE_URL` (incluye la prueba de autorización entre usuarios)
