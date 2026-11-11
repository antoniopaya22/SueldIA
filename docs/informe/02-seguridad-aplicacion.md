# 02 · Seguridad de la aplicación (más allá de RLS)

La alerta de Supabase está en `01-seguridad-supabase-rls.md`. Este fichero cubre el código: autenticación, autorización, entrada de datos, frontend y cabeceras. Las dependencias vulnerables están en `08`.

**[V]** = verificado leyendo el código citado. **[S]** = sospecha por confirmar. Rutas relativas a `backend/src/` salvo indicación.

## 1. Resumen

| Área | Estado |
|---|---|
| Acceso directo a la base de datos por la Data API | **Abierto** — ver `01` |
| Autorización entre usuarios en la API Express (IDOR) | **Sin hallazgos** tras revisar todas las rutas |
| Verificación de tokens | Correcta, con detalles mejorables |
| Un usuario puede degradar el servicio para los demás | **Sí**, por una fecha inválida (2.1) |
| Validación de entrada | Sistemática con Zod, con huecos concretos |
| Cabeceras de seguridad del frontend | **No hay** |
| Exportaciones CSV | Vulnerables a inyección de fórmulas |
| Dependencias | 29 avisos — ver `08` |

## 2. Hallazgos por gravedad

### 2.1. ALTA — Un usuario puede romper el cron diario de todos [V]

- `routes/recurring-transactions.ts:33` valida `startDate` solo con `/^\d{4}-\d{2}-\d{2}$/`; `"2025-02-32"` pasa.
- La regla se guarda. Después `addDaysIso` (`services/recurring-transactions.service.ts:31-35`) construye una fecha inválida y `toISOString()` lanza `RangeError`. La petición devuelve 500, pero la regla **ya está guardada y activa**.
- `syncAllUsersRecurringTransactions` (`:333-343`) recorre los usuarios en un bucle sin `try/catch`. Al llegar a ese usuario, lanza.
- `routes/cron.ts:32-35` ejecuta primero los recurrentes y después las alertas, en el mismo bloque.

Consecuencia: a partir de ese momento, cada día, los usuarios posteriores en el bucle no reciben sus movimientos recurrentes y **nadie** recibe alertas. Basta una petición, intencionada o un simple error de un cliente.

**Corrección (las tres):**
1. Validar fechas de verdad, en un esquema compartido (ver 3.1).
2. `try/catch` por usuario dentro de `syncAllUsersRecurringTransactions`, registrando el error y siguiendo.
3. En `cron.ts`, que un fallo en recurrentes no impida evaluar alertas (dos bloques independientes) y que la respuesta refleje fallos parciales.

Y revisar la base de datos por si ya existe alguna regla con fecha inválida.

### 2.2. ALTA — Frontend estático sin cabeceras de seguridad [V]

`vercel.json` no tiene bloque `headers`. `helmet` solo protege las respuestas de `/api`, y con la política de contenido desactivada (`index.ts:44-48`). Las páginas HTML se sirven sin `Content-Security-Policy`, sin protección contra incrustación en marcos, sin `Referrer-Policy` y sin `Permissions-Policy`.

Importa especialmente aquí porque el token de sesión de Supabase vive en `localStorage` (configuración por defecto de `supabase-js`, `frontend/src/lib/supabase.ts`): cualquier script inyectado puede leerlo. Hoy no he encontrado ningún punto de inyección (no hay `dangerouslySetInnerHTML`; React escapa todo), pero la CSP es la red de seguridad para el día que aparezca uno, o para una dependencia comprometida.

**Corrección:** bloque `headers` en `vercel.json` para todas las rutas:

```
Content-Security-Policy: default-src 'self'; script-src 'self' <hashes de los scripts en línea de Layout.astro>;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com;
  connect-src 'self' https://<ref>.supabase.co; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Empezar con `Content-Security-Policy-Report-Only` unos días para detectar qué rompe. [S] No he comprobado cómo aplica `headers` el modo «services» de Vercel; hay que probarlo en un despliegue de vista previa.

### 2.3. MEDIA — Inyección de fórmulas en los CSV exportados [V]

`routes/export.ts:211-222` y `:307-317` solo entrecomillan valores con coma, comilla o salto de línea. Un beneficiario, nota, empresa o nombre de fichero que empiece por `=`, `+`, `-` o `@` se interpreta como fórmula al abrir el CSV en Excel o LibreOffice. Los beneficiarios pueden venir de un fichero importado de terceros.

**Corrección:** una única función `toCsv()` (hoy el escapado está duplicado) que anteponga `'` a los valores de texto que empiecen por `=`, `+`, `-`, `@`, tabulador o retorno de carro, y que entrecomille también `\r`.

### 2.4. MEDIA — El middleware de autenticación convierte cualquier fallo en 401 [V]

`middleware/auth.ts` envuelve en un mismo `try/catch` la verificación del token **y** las consultas a `users`. Consecuencias:

- Si la base de datos falla o tarda, el usuario recibe «Token inválido o expirado» y el frontend le cierra la sesión (`frontend/src/lib/api.ts:39-42`). Una caída breve de la base de datos expulsa a todo el mundo.
- **Carrera en el primer acceso:** la app lanza varias peticiones en paralelo al cargar. Para un usuario nuevo, todas ven que no existe y todas intentan insertarlo; la segunda viola la restricción única, cae al `catch` y devuelve 401. El primer inicio de sesión de alguien puede acabar con la sesión cerrada.
- **Colisión de correo:** `users.email` es único. Si dos identidades de Supabase comparten correo (por ejemplo, tras borrar la cuenta sin `SUPABASE_SERVICE_ROLE_KEY` y volver a entrar con otra identidad), el alta falla siempre con 401, sin explicación.

**Corrección:** separar los dos bloques (fallo de token → 401; fallo de base de datos → 503 por `next(err)`); alta con `INSERT … ON CONFLICT (supabase_user_id) DO UPDATE … RETURNING`; decidir qué hacer ante correo duplicado (lo más simple: quitar la unicidad de `email` y tratar `supabase_user_id` como única identidad).

### 2.5. MEDIA — Caché de usuario tras eliminar la cuenta [V]

`auth.ts` guarda en memoria `(sub → userId)` durante 5 minutos. Tras `DELETE /api/auth/me`:

- La instancia que atendió el borrado, y cualquier otra, conserva la entrada: un token aún válido sigue pasando el middleware con un `userId` que ya no existe. Las lecturas devuelven vacío y las escrituras fallan por clave foránea (500).
- Pasados los 5 minutos, si el token sigue vivo (duran una hora) y no se configuró la service role key, el middleware **vuelve a crear** el usuario. Para quien acaba de ejercer su derecho de supresión, es un mal resultado.

**Corrección:** borrar la entrada de la caché en el propio `DELETE /me`; cerrar la sesión de Supabase desde el frontend inmediatamente; y hacer obligatoria `SUPABASE_SERVICE_ROLE_KEY` en producción (validarlo en `config.ts` cuando `NODE_ENV === "production"`).

### 2.6. MEDIA — El borrado de cuenta no es atómico y puede informar de un éxito falso [V]

`routes/auth.ts:76-103`: primero borra la identidad en Supabase y después los datos. Si lo segundo falla, la identidad ya no existe y los datos quedan huérfanos. Al revés: si Supabase falla, solo se escribe en el log, se borran los datos y se responde `{ok: true}`; la identidad sigue activa sin que nadie lo sepa.

**Corrección:** borrar primero los datos, después la identidad, y devolver un estado distinto si el segundo paso falla, para que la interfaz pueda decirlo.

### 2.7. MEDIA — Importes y colecciones sin acotar [V]

- Importes sin `.finite()` ni máximo en cuentas, transacciones, recurrentes, presupuesto y conceptos de nómina. Zod 3 acepta `Infinity` (`1e999` en JSON). Postgres lo guarda, las sumas pasan a infinito y la respuesta JSON lo convierte en `null`. Solo afecta al propio usuario, pero deja sus saldos rotos sin arreglo desde la interfaz.
- `PUT /payslips/:id/concepts` (`routes/payslips.ts:259-273`): lista de conceptos sin tope, nombres y empresa sin longitud máxima, mes y año sin `.int()`.
- `POST /transactions/bulk` (`routes/transactions.ts:741-831`): **el frontend no lo usa**, acepta listas sin tope, importes a cero, traspasos sin pareja, y no usa transacción. Es superficie de ataque sin función.
- `GET /transactions` admite `limit` hasta 10.000 (el frontend pide 50).
- Sin topes por usuario en reglas de alerta, cuentas, categorías, etiquetas, recurrentes ni notas. Una regla recurrente con fecha de inicio antigua genera hasta 1.000 movimientos de golpe.

**Corrección:** esquemas compartidos (`moneySchema`, `idSchema`, `isoDateSchema`, `monthSchema`) en un módulo común y usarlos en todas las rutas; eliminar `/transactions/bulk`; bajar `limit` a 200; topes razonables por usuario.

### 2.8. BAJA

| # | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| a | El secreto del cron se compara con `!==` (no en tiempo constante) | `routes/cron.ts:28` | `crypto.timingSafeEqual` |
| b | Un JSON mal formado en el cuerpo devuelve 500 en lugar de 400 | `middleware/error-handler.ts` no trata el error de `express.json()` | Rama para `err.type === "entity.parse.failed"` → 400 |
| c | Actualizaciones y borrados «por id a secas» tras una comprobación previa de propiedad, sin `userId` en el `WHERE` | `routes/accounts.ts:166`, `categories.ts:195, 219`, `transactions.ts:392, 529, 534, 571, 577, 703, 734`, varios en `payslips.ts` | Hoy es seguro; deja de serlo en cuanto alguien retire la comprobación previa. Incluir siempre el predicado de usuario y centralizar en `utils/ownership.ts` (la comprobación de categoría está triplicada) |
| d | Respuestas distintas ante recursos ajenos: 403, 400, 200 vacío o 404 según la ruta | `payslips.ts:53`, `/transactions/bulk`, `/analytics` | 404 siempre; no revela si el recurso existe |
| e | La configuración de las reglas de alerta se guarda sin sanear (el objeto original, no el validado) y cambiar el tipo no revalida la configuración existente | `routes/alerts.ts:62, 92-104` | Guardar el resultado validado, esquemas estrictos |
| f | Búsqueda de nóminas con `ilike` sin escapar `%` y `_` (no es inyección: va parametrizada; devuelve resultados de más) | `routes/payslips.ts:178` | Usar el `escapeLike` que ya emplea transacciones |
| g | `uncaughtException` se registra y se ignora | `index.ts:131-137` | Registrar y terminar el proceso |
| h | Límite de peticiones en memoria por instancia; el de `/api/auth` afecta a `GET /me` (ver `04`, punto 1.5) | `index.ts:55-76` | Sacar `/me` del límite; valorar almacén compartido si crece el uso |
| i | El frontend no comprueba la sesión antes de pintar `/app/*` y no conserva el destino tras el login | ver `04`, sección 7 | Guardia de sesión y parámetro `next` validado |
| j | Preferencias y último perfil quedan en `localStorage` tras cerrar sesión; la política de cookies no las menciona | ver `04`, punto 7.8 | Limpiar y documentar |

## 3. Refuerzos transversales

### 3.1. Fechas: validar una vez, bien

Las fechas se guardan como texto y se validan con expresiones regulares que aceptan `2025-13-45` o el mes `2025-00` (`transactions.ts:30, 750`; `recurring-transactions.ts:33-34`; `transaction-query.ts:10`; `finance.ts:20-21`; `budgets.ts:9`; `dashboard.ts:20-21`). Además del punto 2.1, una sola transacción con mes inválido deja en blanco toda la analítica de finanzas (`services/finance.service.ts:191-206`), y un mes de presupuesto `2025-13` crea asignaciones invisibles que sí cuentan en el acumulado.

- Un `isoDateSchema` que reconstruya la fecha y compare, y un `monthSchema` con `(0[1-9]|1[0-2])`.
- Aplicarlos también a las filas del importador de YNAB (`routes/import.ts:136-149`), que hoy inserta lo que devuelva el analizador.
- En la base de datos, una restricción `CHECK` sobre el formato (o migrar a tipo `date`) como última barrera.

### 3.2. Lo que la autorización hace bien

Dejo constancia porque es lo más importante de una app multiusuario y está bien resuelto: todas las consultas por identificador filtran por usuario, directamente o a través de perfil/grupo; todos los identificadores ajenos que llegan en el cuerpo (cuenta, categoría, perfil, nómina, etiqueta, transacción a enlazar) se comprueban; los filtros por identificador en consultas no se comprueban pero van siempre combinados con el usuario, de modo que un identificador ajeno devuelve vacío.

Lo que falta es que **una prueba automática lo garantice** (ver `08`, sección 2): hoy depende de que cada ruta nueva repita el patrón a mano.

### 3.3. Datos personales (RGPD)

- `payslips.raw_text` guarda en claro el texto completo de cada nómina. Opciones, de menos a más: (a) no devolverlo en listados ni exportaciones parciales (hoy viaja en el listado, ver `03`); (b) ofrecer al usuario «borrar el texto original» una vez revisada la nómina, a costa de no poder reprocesarla; (c) cifrarlo en reposo con una clave fuera de la base de datos.
- `GET /export/all` no incluye `category_targets`, `category_rules` ni `user_preferences`, aunque se presenta como exportación completa (`routes/export.ts:48-73`).
- Los logs de `pino-http` registran URL y cabeceras de cada petición. Comprobar que no se registra `Authorization` (configurar `redact: ["req.headers.authorization"]`) y que las URL con texto de búsqueda no acaban en logs de larga retención.
- La política de privacidad debería nombrar a los encargados de tratamiento reales (Supabase, Vercel, Google) y la región de los datos.

### 3.4. Subida de ficheros

Bien: en memoria, tamaño limitado a 4 MB, comprobación de tipo y de cabecera `%PDF`, máximo 20 páginas, tiempo límite de 10 s. A mejorar:

- `isEvalSupported: false` en pdfjs (ver `08`, 1.2).
- El tiempo límite usa `Promise.race`, que no cancela el trabajo de pdfjs: tras los 10 s sigue consumiendo CPU hasta terminar. Llamar a `loadingTask.destroy()` al vencer.
- Límite de peticiones propio para la subida, más bajo que el global.
