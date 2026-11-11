# SueldIA — Instrucciones para Agentes de IA

## Visión General

Aplicación web monorepo de gestión y análisis de nóminas españolas. Solo versión web (sin escritorio, sin OCR — ver `old/` para la versión anterior con Electron/Tesseract, retirada). Backend Express + Frontend Astro estático + Postgres (Supabase), desplegados como dos "Services" de un mismo proyecto de Vercel (`vercel.json` en la raíz).

## Arquitectura

```
[Browser] → [Astro estático + React islands] → Vercel rewrites /api/* → [Express, servicio "backend" de Vercel] → [Postgres (Supabase)]
```

- **Frontend**: Astro (salida estática) + React islands con `client:load`, UI con shadcn/ui. En dev, proxy de Vite hacia el backend local.
- **Backend**: Express normal (`backend/src/index.ts`, `export default app`) — `vercel.json` lo despliega como servicio (`"framework": "express"`, `root: "backend"`), sin wrapper de función ni `api/index.ts` (ese wrapper ya no existe). `app.listen()` solo corre fuera de Vercel (desarrollo local). Un cron diario (`vercel.json` → `crons`, `/api/cron/daily`) evalúa alertas y sincroniza recurrentes — ver `backend/AGENTS.md`.
- **Base de datos**: Postgres en Supabase. Drizzle ORM (`drizzle-orm/postgres-js`) para schema y queries — sin dependencias nativas.
- **Sin storage de archivos**: los PDFs de nóminas se procesan en memoria al subirlos y se descartan — solo se guarda el texto extraído (`rawText`) y los conceptos ya estructurados. `old/` es la referencia de la versión anterior (SQLite + disco local + Electron + OCR), no se mantiene.

## Tablas de Base de Datos

| Tabla | Propósito |
|---|---|
| `users` | Cuentas de usuario (email, name, supabase_user_id — login vía Google/Supabase Auth) |
| `profiles` | Perfiles/personas cuyas nóminas se gestionan |
| `payslips` | Nóminas subidas (metadata, salarios, status de parsing) |
| `payslip_concepts` | Conceptos extraídos (devengos, deducciones) |
| `payslip_notes` | Notas libres por nómina |
| `tags` | Etiquetas reutilizables |
| `payslip_tags` | Relación M:N nóminas ↔ tags |
| `alert_rules` | Reglas de alerta configurables (nóminas y finanzas) |
| `alert_history` | Historial de alertas emitidas |
| `accounts` | Cuentas (banco, tarjeta, efectivo, inversión, préstamo, hipoteca) con saldo inicial y orden; los préstamos guardan importe, TIN, plazo y primera cuota (cuadro de amortización) |
| `account_valuations` | «Actualizar valor» de una cuenta (inversiones): desde esa fecha, saldo = valor + movimientos posteriores. No es un movimiento |
| `category_groups` / `categories` | Grupos y categorías del presupuesto (categories no tiene `user_id`: la propiedad va por el grupo) |
| `transactions` | Movimientos: gastos, ingresos, traspasos (dos filas enlazadas por `transfer_id`), partes de un gasto dividido (`split_group_id`), ocurrencias de recurrentes, enlace opcional a una nómina |
| `recurring_transactions` | Reglas recurrentes que generan ocurrencias (cron diario y al crear/editar) |
| `budgets` | Asignado por categoría y mes (`YYYY-MM`) |
| `category_targets` | Objetivo por categoría (mensual o para una fecha) |
| `category_rules` | «Si el beneficiario contiene X → categoría Y» |
| `user_preferences` | Preferencias de interfaz (clave → JSON) |
| `recurring_skips` | Ocurrencias de una recurrente que no se generan («saltar esta vez», o el pasado al crear «desde hoy») |
| `savings_goals` | Objetivos de ahorro (importe, fecha, cuenta asociada o cantidad apuntada a mano) |
| `push_subscriptions` | Dispositivos con avisos push activados (Web Push) |

**RLS**: todas las tablas tienen Row Level Security activado y sin políticas (`.enableRLS()` en `schema.ts`). La app no usa la Data API de Supabase; el backend se conecta como propietario. Una tabla nueva sin `.enableRLS()` hace fallar `db:migrate`.

## Flujo de Parsing de Nóminas

1. Usuario sube PDF(s) → Multer los recibe en memoria (`multer.memoryStorage()`, sin tocar disco) → se crea registro con status `pending`
2. **Síncrono, dentro de la misma petición** (no hay OCR de respaldo que lo haga lento, y así no depende de que la función siga viva tras responder): `parserEngine.parsePayslip(buffer)`
3. Extracción de texto posicional con `pdfjs-dist` (agrupa por fila/columna — ver `backend/AGENTS.md`)
4. `conceptMatcher` aplica reglas regex para extraer: periodo, empresa, salario bruto/neto, conceptos individuales
5. Actualiza registro con datos extraídos y status `parsed` o `review` (si no se encontró ningún concepto) o `error`

## Convenciones de Commits

Usar formato Conventional Commits:
```
tipo(scope): descripción breve en español

[cuerpo opcional con más detalle]
```

Tipos válidos: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `style`, `perf`
Scopes válidos: `backend`, `frontend`, `db`, `parsers`, `auth`, `api`, `ui`, `deps`

## Reglas para Agentes

1. **No romper funcionalidad existente** — verificar que los cambios no afecten código que ya funciona
2. **Seguir patrones existentes** — mirar cómo están implementadas features similares antes de crear nuevas
3. **Validar siempre inputs** — usar Zod en backend, tipos TypeScript en frontend
4. **No instalar dependencias** sin justificación clara — el proyecto ya tiene un stack definido
5. **Respetar la estructura de carpetas** — cada dominio tiene su lugar asignado
6. **Mensajes al usuario en español** — todo texto visible para el usuario final debe estar en español
7. **Tests y linting** — si se añade funcionalidad nueva, verificar que compila (`npm run build`)
8. **Variables de entorno** — nunca hardcodear, usar `config.ts` que valida con Zod
