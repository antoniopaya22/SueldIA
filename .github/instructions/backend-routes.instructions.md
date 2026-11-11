---
name: 'Backend Routes'
description: 'Patrones y convenciones para rutas Express en el backend'
applyTo: 'backend/src/routes/**'
---

# Patrones de Rutas Express — Backend

Fuente de verdad: [`backend/AGENTS.md`](../../backend/AGENTS.md). Referencia real: `backend/src/routes/accounts.ts`.

## Estructura de cada archivo de ruta

Cada archivo en `backend/src/routes/` sigue este orden:

1. Imports (express, zod, db, schema, operadores drizzle, helpers de `utils/`) — relativos con extensión `.js`
2. Inicialización del Router: `export const domainRouter = Router();` y, si hay rutas con `:id`, `domainRouter.param('id', validateIdParam);`
3. Schemas de validación Zod (junto a la ruta que los usa)
4. Handlers de ruta (GET list, GET :id, POST, PUT :id, DELETE :id). Rutas fijas (`/order`, `/batch`…) antes de las de `:id`

## Patrón de Handler

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { validateIdParam } from '../middleware/params.js';
import { moneySchema } from '../utils/validation.js';

export const accountsRouter = Router();
accountsRouter.param('id', validateIdParam);

const updateSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  initialBalance: moneySchema.optional(),
});

accountsRouter.put('/:id', async (req, res, next) => {
  try {
    const { userId } = req.user!;
    const id = Number(req.params.id);

    // 1. Validar input
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos de cuenta inválidos',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // 2. Query Drizzle (async) — SIEMPRE filtrando por el dueño
    const [updated] = await db
      .update(accounts)
      .set(parsed.data)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
      .returning();

    // 3. Verificar existencia (ajeno o inexistente → 404, sin distinguir)
    if (!updated) {
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }

    // 4. Respuesta
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
```

## Validación con Zod

- Siempre usar `.safeParse()` (no `.parse()` que lanza excepciones)
- Responder 400 inmediatamente con `error.flatten().fieldErrors`
- Schemas inline cuando son específicos de una ruta
- Mensajes de error en español
- **Helpers obligatorios** (no reinventarlos):
  - Fechas: `isoDateSchema` / `monthKeySchema` de `../utils/dates.js` (rechazan fechas que no existen); "hoy" con `todayIso()` (hora de Madrid) — nunca `new Date().toISOString()` ni una regex suelta
  - Importes: `moneySchema` / `positiveMoneySchema()` de `../utils/validation.js` (finitos y acotados) — nunca `z.number()` a secas
  - Ids en el body: `idSchema` de `../utils/validation.js`

## Status Codes

| Code | Uso |
|------|-----|
| 200 | Lectura exitosa, actualización exitosa |
| 201 | Recurso creado |
| 400 | Input inválido (validación Zod, id de ruta no numérico) |
| 401 | No autenticado (lo responde `authMiddleware`) |
| 404 | Recurso no encontrado **o de otro usuario** |
| 409 | Tope por usuario alcanzado (`assertUnderLimit`) o conflicto |
| 500 | Error interno (manejado por `error-handler`) |

Errores operacionales desde servicios: `throw new AppError(status, 'Mensaje en español')` (`../middleware/error-handler.js`).

## Convenciones Drizzle en Rutas

El driver es `postgres-js`: **todo es asíncrono y devuelve arrays**. Nada de `.get()`, `.all()` ni `.run()`.

```typescript
import { and, desc, eq, ilike, sql } from 'drizzle-orm';

// SELECT de una fila (filtrando por dueño)
const [account] = await db
  .select()
  .from(accounts)
  .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));

// SELECT de lista
const rows = await db
  .select()
  .from(accounts)
  .where(eq(accounts.userId, userId))
  .orderBy(desc(accounts.createdAt));

// INSERT con returning
const [created] = await db.insert(accounts).values({ ...parsed.data, userId }).returning();

// UPDATE / DELETE con returning (para saber si existía y era suyo)
const [deleted] = await db
  .delete(accounts)
  .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
  .returning();

// Conteo: count(*) es bigint → cast a int
const [{ count }] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(accounts)
  .where(eq(accounts.userId, userId));

// Búsqueda de texto: ilike (Postgres es case-sensitive)
const matches = await db
  .select()
  .from(accounts)
  .where(and(eq(accounts.userId, userId), ilike(accounts.name, `%${q}%`)));

// Varias escrituras como unidad
await db.transaction(async (tx) => {
  await tx.update(accounts).set({ sortOrder: 0 }).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
});
```

Tablas hijas de una nómina (`payslip_concepts`, `payslip_notes`, `payslip_tags`) no tienen `user_id`: comprobar la propiedad con `userOwnsPayslip(userId, payslipId)` de `../utils/ownership.js` o con un join `payslips → profiles` filtrando `profiles.userId`.

## Paginación

Para endpoints de lista, usar query params `page` y `limit` (acotado) y responder `{ data, total, page, limit }`:
```typescript
const page = Math.max(1, Number(req.query.page) || 1);
const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
const offset = (page - 1) * limit;
```

## Acceso al Usuario Autenticado

`authMiddleware` verifica el JWT de Supabase y deja el usuario en `req.user` (tipado por augmentación global en `middleware/auth.ts`):
```typescript
const { userId } = req.user!;
```

## Altas, exportaciones y pruebas

- Altas de recursos con tope por usuario: `await assertUnderLimit(tabla, tabla.userId, userId, USER_LIMITS.x, 'etiqueta')` (`../utils/limits.js`)
- CSV: solo con `toCsv(headers, rows)` de `../utils/csv.js` (escapa y neutraliza fórmulas)
- Toda ruta nueva que reciba un id (en la URL o en el body) se añade a `backend/src/routes/authorization.test.ts`

## Registro de Nuevas Rutas

Después de crear un nuevo archivo de ruta, registrarlo en `backend/src/index.ts`, siempre detrás de `authMiddleware`:
```typescript
import { newRouter } from './routes/new.js';
// ... en la sección de rutas protegidas:
app.use('/api/new', authMiddleware, newRouter);
```
