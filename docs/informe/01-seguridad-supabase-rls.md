# 01 · Seguridad en Supabase: la alerta «RLS Disabled in Public»

> Prioridad: **crítica — hacer antes que cualquier otra cosa de este informe.**
> Esfuerzo: una migración SQL de ~40 líneas y dos ajustes en el panel de Supabase.

## 1. Qué significa la alerta

Supabase publica automáticamente una API REST (PostgREST, «Data API») sobre todas las tablas del esquema `public`:

```
https://<ref>.supabase.co/rest/v1/<tabla>
```

Esa API se usa con la *anon key*, que es pública por diseño: en SueldIA va dentro del bundle del navegador (`PUBLIC_SUPABASE_ANON_KEY`, `frontend/src/lib/supabase.ts`). Lo único que impide que cualquiera con esa clave lea o escriba una tabla es **Row Level Security (RLS)**. Con RLS desactivado, y con los permisos que Supabase concede por defecto a los roles `anon` y `authenticated`, la tabla queda abierta.

## 2. Por qué ocurre en SueldIA

- Ninguna de las 11 migraciones (`backend/src/db/migrations/0000…0010`) contiene `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT` ni `REVOKE` (comprobado con `grep`).
- Drizzle crea las tablas con el rol `postgres` en `public`, así que heredan los privilegios por defecto de Supabase.
- La aplicación no lo nota porque **no usa la Data API**: todo pasa por Express, que se conecta a Postgres directamente (`backend/src/db/index.ts`) y filtra por `userId` en cada consulta. El frontend solo usa `supabase-js` para el login (no hay ningún `supabase.from(...)`, `.rpc(...)` ni `.storage` en `frontend/src`).

Es decir: el control de acceso de Express está bien, pero hay una **segunda puerta** a la misma base de datos que no pasa por Express.

## 3. Alcance real

La alerta que has pegado menciona `public.users`, pero el problema es el mismo en **las 18 tablas**:

| Tabla | Qué contiene |
|---|---|
| `users` | email, nombre, id de Supabase Auth |
| `profiles` | personas cuyas nóminas se gestionan |
| `payslips` | empresa, bruto, neto y **`raw_text`: el texto completo de la nómina** (nombre, NIF, nº de afiliación a la SS, IBAN, domicilio…) |
| `payslip_concepts`, `payslip_notes`, `tags`, `payslip_tags` | detalle de cada nómina |
| `alert_rules`, `alert_history` | reglas y avisos |
| `accounts`, `transactions`, `recurring_transactions` | cuentas, saldos y todos los movimientos |
| `category_groups`, `categories`, `category_rules` | organización del presupuesto |
| `budgets`, `category_targets` | presupuesto y objetivos |
| `user_preferences` | preferencias de interfaz |

Si los privilegios por defecto siguen activos, cualquiera que abra las herramientas de desarrollo en la web, copie la URL del proyecto y la anon key, puede leer, modificar o borrar los datos de **todos** los usuarios. `raw_text` es el campo más sensible: son datos personales y económicos en claro.

### Cómo comprobarlo (2 minutos)

No lo he ejecutado contra tu proyecto (no tengo las claves y es tu entorno de producción). Con los valores de tu `.env.local`:

```bash
curl -s "$PUBLIC_SUPABASE_URL/rest/v1/users?select=id,email&limit=3" \
  -H "apikey: $PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY"
```

- Devuelve filas → la exposición es real ahora mismo.
- Devuelve `[]` o un error de permisos → algo ya lo está frenando, pero la corrección de abajo sigue siendo necesaria (la alerta no desaparece sin ella).

Si devuelve filas, conviene además revisar en Supabase (Logs → API / PostgREST) si ha habido peticiones a `/rest/v1/` que no sean tuyas. Como la app no usa esa API, **cualquier** petición ahí es ajena.

## 4. Corrección

Tres capas, de la imprescindible a la recomendable.

### 4.1. Activar RLS en todas las tablas, sin políticas (imprescindible)

RLS activado **sin ninguna política** = nadie entra por la Data API. El backend sigue funcionando igual porque se conecta como `postgres`, que es el propietario de las tablas, y el propietario no está sujeto a RLS (salvo que se use `FORCE ROW LEVEL SECURITY`, que **no** hay que usar aquí).

Migración nueva (`cd backend && npx drizzle-kit generate --custom --name enable_rls` crea el fichero vacío y lo registra en el journal):

```sql
-- 0011_enable_rls.sql
-- La app no usa la Data API de Supabase (PostgREST): todo el acceso pasa por
-- Express, que se conecta como propietario de las tablas y no está sujeto a
-- RLS. Activarlo sin políticas cierra el acceso a los roles anon/authenticated.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payslip_concepts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payslip_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payslip_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "category_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
```

Antes de desplegar, confirma con qué rol se conecta el backend (el usuario de `DATABASE_URL`). Con el pooler de Supabase es `postgres.<ref>`, que equivale a `postgres`. Si fuera otro rol que no es propietario de las tablas, el backend dejaría de ver filas: en ese caso hay que dar a ese rol `BYPASSRLS` o crear políticas para él.

Para aplicarlo ya, sin esperar a un despliegue, el mismo SQL se puede pegar en el SQL Editor de Supabase. Si lo haces así, crea igualmente la migración para que el repositorio refleje el estado real; `ENABLE ROW LEVEL SECURITY` es idempotente y no falla al repetirse.

### 4.2. Retirar los privilegios a `anon` y `authenticated` (defensa en profundidad)

Con 4.1 basta para cerrar el acceso, pero deja la seguridad dependiendo de que nadie olvide el `ENABLE` en una tabla futura. Esto quita además el permiso de base, también para las tablas que se creen después:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
```

`service_role` se deja como está: no se usa para datos (la service role key solo llama a la Admin API de Auth en `DELETE /api/auth/me`), y no está en el navegador.

### 4.3. Apagar la Data API (recomendado)

Como la aplicación no la usa, lo más limpio es que no exista:

- Supabase → Project Settings → **Data API** → desactivar «Enable Data API», o quitar `public` de «Exposed schemas».
- El login no se ve afectado: Supabase Auth (`/auth/v1`) es un servicio aparte de PostgREST (`/rest/v1`).

Con la Data API apagada la alerta deja de tener sentido, pero mantén 4.1 igualmente: si algún día se vuelve a activar, las tablas ya estarán cerradas.

## 5. Que no vuelva a pasar

1. **RLS en el esquema de Drizzle.** `drizzle-orm` 0.38 (la versión instalada) admite `pgTable(...).enableRLS()`; con eso cada tabla nueva sale ya con su `ENABLE ROW LEVEL SECURITY` en la migración generada. Hay que comprobar que `drizzle-kit` 0.30 lo emite correctamente antes de fiarse (genera una migración de prueba y léela).
2. **Test que lo vigile.** Una comprobación que falle si aparece una tabla sin RLS:
   ```sql
   SELECT tablename FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity = false;
   ```
   Se puede ejecutar al final de `backend/src/db/migrate.ts` (y abortar el despliegue si devuelve filas) o como paso de CI.
3. **Regla en `AGENTS.md` y en `.github/instructions/drizzle-schema.instructions.md`:** «toda tabla nueva lleva RLS activado; la app no usa la Data API».
4. **Revisar el Security Advisor de Supabase después de cada migración** que cree tablas.

## 6. Otros ajustes del proyecto de Supabase

No son la alerta que has pegado, pero están en la misma pantalla y conviene dejarlos cerrados:

| Ajuste | Por qué | Dónde |
|---|---|---|
| Desactivar el proveedor **Email** (registro con contraseña) si el único login es Google | Con la anon key cualquiera puede llamar a `/auth/v1/signup`. Un usuario creado así obtiene un JWT válido con `aud: authenticated` y `authMiddleware` le crearía cuenta en SueldIA (`backend/src/middleware/auth.ts`). No da acceso a datos ajenos, pero es una vía de alta que la app no contempla | Authentication → Providers |
| Desactivar **Anonymous sign-ins** | No se usan. Hoy el middleware los rechaza porque el token no trae `email`, pero es mejor que no se emitan | Authentication → Providers |
| **Redirect URLs** limitadas al dominio de producción y `http://localhost:4321` | Evita que un enlace de login manipulado devuelva la sesión a otro sitio | Authentication → URL Configuration |
| Comprobar que el pooler exige **SSL** | La conexión del backend viaja por internet | Database → Settings |
| **Copias de seguridad / PITR** | Con RLS abierto alguien podría haber borrado datos; y en general no hay otra copia (los PDF no se guardan) | Database → Backups |
| Alertas de rendimiento «Unindexed foreign keys» | Ver `03-backend-y-base-de-datos.md`, apartado de índices | Advisors → Performance |

## 7. Si la comprobación del punto 3 devolvió filas

Tratarlo como una posible fuga de datos, no solo como una configuración que corregir:

1. Aplicar 4.1 de inmediato desde el SQL Editor.
2. Revisar los logs de la Data API durante el periodo de retención disponible.
3. Comprobar la integridad de los datos (recuentos por tabla, usuarios desconocidos en `users`).
4. Si hay usuarios distintos de ti y hay indicios de acceso ajeno, el RGPD obliga a valorar la notificación a la AEPD (72 horas) y a los afectados. Eso es una decisión tuya, con asesoramiento si hace falta; el informe solo lo señala.
5. Rotar la anon key no aporta nada (es pública por diseño). Rotar la contraseña de la base de datos y la service role key solo si hay indicios de que se han filtrado por otra vía.
