# 03 · Backend y base de datos: errores, rendimiento y diseño de la API

Rutas relativas a `backend/src/`. **[V]** verificado en el código · **[S]** sospecha. Los fallos con implicación de seguridad están en `02`.

## 1. Errores de comportamiento

### Gravedad alta

**1.1. Liquidar un traspaso solo cambia una de sus dos patas [V]**
`routes/transactions.ts:713-738` (`PATCH /transactions/:id/clear`) actualiza la fila pedida, o todo el grupo si es un gasto dividido, pero no toca la pareja (`transferId`). Como solo lo liquidado cuenta en el saldo, el dinero sale de una cuenta y no entra en la otra. El frontend usa este punto de entrada. La acción en lote y la edición sí arrastran la pareja.
*Corrección:* incluir la pareja en el `WHERE`, o reutilizar la lógica de la acción en lote.

**1.2. Una fecha inválida en una regla recurrente tumba el cron de todos [V]**
Ver `02`, punto 2.1.

**1.3. Reprocesar destruye las correcciones manuales [V]**
`routes/payslips.ts:527-550` sobrescribe bruto, neto, periodo, empresa, estado y todos los conceptos. `PUT /:id/concepts` no deja ninguna marca de «editada a mano». `POST /payslips/reparse` lo hace con todas las nóminas del usuario a la vez, sin deshacer.
*Corrección:* columna `manually_edited` que active la edición manual; el reprocesado masivo la respeta salvo que se fuerce; el individual pide confirmación.

### Gravedad media

**1.4. «Hoy» se calcula en UTC, no en hora española [V]**
`services/recurring-transactions.service.ts:53-55`, `finance.service.ts:427-428`, `dashboard.service.ts:176-177`, `analytics.service.ts:242`, `alerts.service.ts:103-104`. En Vercel el servidor va en UTC. Entre las 00:00 y la 01:00 (invierno) o las 02:00 (verano), un gasto con fecha de hoy se considera futuro y queda pendiente, sin afectar al saldo; el día 1 a esa hora el resumen muestra el mes anterior.
*Corrección:* una única función `todayInMadrid()` con `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" })` y derivar de ella año y mes en todos los sitios. A medio plazo, zona horaria por usuario.

**1.5. Traspasos huérfanos del importador que no se pueden editar [V]**
`routes/import.ts:213` guarda `transferId: 0` como centinela. La edición (`transactions.ts:452-463`) lo trata como traspaso real, busca la fila 0 y devuelve 404. Solo se pueden borrar.
*Corrección:* tratar pareja inexistente como «sin pareja». Mejor: columna `transfer_direction` y `transfer_id` nulo, lo que además elimina la heurística `transferId < id` usada para deducir el sentido.

**1.6. Borrar una cuenta deja medios traspasos [V]**
`routes/accounts.ts:136-146`. La cascada elimina las transacciones de la cuenta; las patas pareja en otras cuentas sobreviven apuntando a filas que no existen (`transfer_id` no tiene clave foránea), siguen contando en el saldo y dan el mismo 404 al editarlas.
*Corrección:* en el borrado, dentro de una transacción, convertir las parejas en ingreso o gasto. Y avisar antes con el número de movimientos afectados, o empujar a archivar en su lugar.

**1.7. Borrar una categoría o un grupo descuadra el presupuesto [V]**
`routes/categories.ts:112-125, 204-224`. Lo asignado vuelve a «Para presupuestar», pero lo gastado pasa a «sin categoría» y deja de descontar de ningún sitio: el disponible total queda inflado con todo el gasto histórico de esa categoría. Además se borran en silencio sus reglas de categorización y su objetivo.
*Corrección:* borrado con reasignación obligatoria (`?reassignTo=<id>`) cuando haya movimientos o asignaciones.

**1.8. «Para presupuestar» ignora el saldo inicial de las cuentas [V; falta confirmar si es intencionado]**
`services/budgets.service.ts:185-195, 261-262` solo suma ingresos. Quien crea una cuenta con 5.000 € de saldo inicial tiene 0 € para asignar. Con datos importados de YNAB no se nota porque allí el saldo inicial es un ingreso. Otros casos sin decidir: lo asignado en meses futuros no descuenta del actual; los gastos sin categoría no reducen nada; cuentas de inversión o archivadas cuentan igual.

**1.9. Las alertas de nóminas eligen mal la «última» nómina [V]**
`services/alerts.service.ts:62-74` ordena por año y mes ascendentes; Postgres pone los nulos al final, y una nómina puede quedar como `parsed` sin periodo. Esa pasa a ser «la última»: la regla de nómina ausente se desactiva sola para ese perfil y las otras tres comparan con la nómina equivocada.
*Corrección:* excluir periodos nulos; y que una nómina sin periodo quede siempre en `review`.

**1.10. La analítica de nóminas mezcla perfiles y genera periodos basura [V]**
`services/analytics.service.ts:35-49, 74-83`: sin perfil, junta las nóminas de todas las personas en una sola serie, con lo que tendencia, anomalías y predicción no significan nada. Una nómina sin periodo genera el mes `"null-00"` y la predicción devuelve meses `"NaN-…"`. El panel tiene el mismo problema (`dashboard.service.ts:121, 222, 235`). El aviso de «faltan nóminas» compara el número de nóminas del último año con datos con el mes actual del calendario.

**1.11. Deduplicado frágil al importar de YNAB [V]**
`routes/import.ts:49-55`. La clave es fecha, importe, cuenta y beneficiario, todos editables: si renombras un beneficiario, al reimportar se duplica. Es un conjunto y no un contador: dos cafés idénticos el mismo día, con uno ya importado, se omiten los dos. No distingue ingreso de gasto. La vista previa cuenta con duplicados y la importación real sin ellos, así que los números no coinciden. Y la lectura de existentes va fuera de la transacción: un doble envío duplica todo.
*Corrección:* columna `import_key` (resumen de la fila original más su ordinal de repetición) con índice único por usuario y `ON CONFLICT DO NOTHING`.

**1.12. El importador no valida ni las fechas ni los números [V]**
`parsers/ynab-csv-parser.ts`: si la fecha no es `DD/MM/YYYY` devuelve el texto tal cual; `12/25/2024` se convierte en `2024-25-12`; `1,234.56` se lee como 1,23. Todo se inserta sin comprobar.

**1.13. La subida deja nóminas `pending` zombis [V]**
`routes/payslips.ts:62-72` inserta en `pending` y después analiza. Si la función muere a mitad de una tanda, la fila queda así para siempre y no se puede reprocesar porque no tiene texto.
*Corrección:* analizar primero en memoria e insertar una sola vez con el estado final, nómina y conceptos en la misma transacción. El estado `pending` deja de ser necesario.

**1.14. Las nóminas duplicadas cuentan doble [V]**
`routes/payslips.ts:94-114` solo avisa. Panel, analítica, exportación y alertas no deduplican: subir dos veces el mismo PDF duplica los totales anuales y el IRPF.
*Corrección:* resumen del texto extraído y rechazo o sustitución explícita.

### Gravedad baja

| # | Fallo | Evidencia |
|---|---|---|
| 1.15 | Mover dinero entre categorías o la asignación rápida leen y escriben valores absolutos: dos operaciones simultáneas pierden una | `services/budgets.service.ts:418-434` |
| 1.16 | «Fecha Subida» sale en el CSV como `Wed Nov 11 2026 … GMT+0000`; decimales con punto y separador coma, que Excel en español abre mal | `routes/export.ts:197, 214` |
| 1.17 | Cambiar a gasto un ingreso enlazado a una nómina conserva el enlace | `routes/transactions.ts:429-665` |
| 1.18 | Al editar un traspaso desde la pata de entrada, la respuesta es la pata de salida, con otro `id` | `routes/transactions.ts:540-546` |
| 1.19 | Dividir un gasto: las comprobaciones van fuera de la transacción; un doble clic divide dos veces | `services/transaction-split.service.ts:43-50` |
| 1.20 | La evaluación de reglas tras crear o editar una se lanza sin esperar y con `.catch(() => {})`: en serverless puede no ejecutarse y el fallo no se registra | `routes/alerts.ts:67, 111` |
| 1.21 | El total de pendientes vencidos suma importes sin signo, mezclando ingresos, gastos y las dos patas de cada traspaso | `services/finance-alerts.service.ts:118` |
| 1.22 | El SMI de 2026 se aplica a nóminas de cualquier año: una de 2022 con 1.100 € salta como «por debajo del SMI» | `services/payslip-validation.service.ts:21, 54` |
| 1.23 | Crear las categorías por defecto con dos clics simultáneos duplica grupos | `services/default-categories.service.ts:57-92` |
| 1.24 | El histórico de saldos ordena las cuentas por nombre, ignorando el orden elegido | `services/balance-history.service.ts:73` |
| 1.25 | El importador asume que `RETURNING` devuelve las filas en el orden de inserción [S]; Postgres lo cumple en la práctica pero no lo garantiza | `routes/import.ts:118-122, 192-201` |

### Correcto según el código, dudoso como producto [S de intención]

- Pausar y reactivar una regla recurrente regenera todas las ocurrencias no liquidadas desde la fecha de inicio, incluidas las del periodo en pausa.
- Crear una regla con fecha de inicio de hace años rellena todo el histórico; con liquidación automática, afectando al saldo.
- La «proyección anual» del año en curso multiplica por el mes actual, no por 12 (`dashboard.service.ts:179, 197`); las medias mezclan pagas extra.
- Las cuentas tienen moneda, pero todo se suma sin convertir y los textos fijan «€».

## 2. Rendimiento

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 2.1 | M | La analítica de finanzas trae todo el histórico y agrega en JavaScript; el frontend llama a varios de estos puntos a la vez, repitiendo la carga | `services/finance.service.ts:233-271` | `GROUP BY` en SQL, como ya hacen `chart-series.service.ts` y `balance-history.service.ts` |
| 2.2 | M | `raw_text` viaja donde no hace falta: listado de nóminas (hasta 100 filas, enviado al navegador), panel, analítica, exportación y alertas hacen `select()` de todas las columnas | `routes/payslips.ts:199-205`, `analytics.service.ts:45-49`, `dashboard.service.ts:48-52`, `alerts.service.ts:62-74` | Proyección explícita sin `raw_text`. También es una mejora de privacidad |
| 2.3 | M | La subida hace por fichero una inserción, el análisis, una transacción y tres consultas, en serie; con 20 PDF son unas 150 idas y vueltas a la base de datos en una sola petición | `routes/payslips.ts:61-122` | Punto 1.13 y paralelismo acotado. [S] Con el límite de 4,5 MB por petición de Vercel, «20 ficheros de 4 MB» no cabe: ajustar el máximo al tamaño total |
| 2.4 | M | El reprocesado masivo carga todas las nóminas con su texto y lanza una transacción por nómina, sin paginar ni poder reanudar | `routes/payslips.ts:492-522` | Por páginas con cursor |
| 2.5 | M | El cron recorre los usuarios en serie y, por cada regla y perfil, vuelve a leer el histórico completo; «categoría excedida» recalcula el presupuesto entero (8 consultas) por regla | `services/alerts.service.ts:265-295`, `recurring-transactions.service.ts:333-344` | Cachear por usuario dentro de la evaluación; concurrencia acotada con `Promise.allSettled`; declarar `maxDuration` |
| 2.6 | M | El importador carga todas las transacciones del usuario solo para deduplicar | `routes/import.ts:49-52` | Acotar al rango de fechas del fichero, o punto 1.11 |
| 2.7 | B/M | Exportaciones sin tope ni paginación; `/export/all` construye todo en memoria, incluido `raw_text` [S: puede superar el límite de respuesta de Vercel con años de datos] | `routes/export.ts:30-97, 261-279` | Respuesta en flujo |
| 2.8 | B | Escrituras fila a fila: una por categoría en la asignación rápida, una por cuenta al reordenar | `budgets.service.ts:330-340`, `accounts.ts:53-60` | Una sola sentencia multi-fila |
| 2.9 | B | El autocompletado de beneficiarios ejecuta una función ventana sobre todas las transacciones en cada pulsación | `services/payee-suggestions.service.ts:35-59` | Caché corta o consulta acotada; retardo en el cliente |
| 2.10 | B | Cada ruta de nómina por identificador hace dos consultas donde bastaría una con `JOIN` | `routes/payslips.ts` | Función `getOwnedPayslip` |

### Índices que faltan

La migración inicial no crea ningún índice aparte de claves primarias y únicas; después se añadieron los de `transactions`, `payslips`, `payslip_concepts`, `budgets`, `category_targets` y `category_rules`. Siguen sin índice estas claves foráneas (el asesor de rendimiento de Supabase las marca como «Unindexed foreign keys»):

| Tabla | Columna | Se usa en |
|---|---|---|
| `profiles` | `user_id` | Toda comprobación de propiedad de nóminas |
| `accounts` | `user_id` | Listado de cuentas, saldos |
| `category_groups` | `user_id` | Árbol de categorías |
| `categories` | `group_id` | Árbol de categorías, comprobación de propiedad |
| `recurring_transactions` | `user_id`, `account_id`, `category_id` | Cron diario, listados, borrados en cascada |
| `alert_rules` | `user_id` | Cron diario |
| `alert_history` | `user_id`, `payslip_id` | Campana (en cada carga de página) |
| `tags` | `user_id` | Etiquetas |
| `payslip_tags` | `tag_id` | Borrado de etiqueta |
| `payslip_notes` | `payslip_id` | Detalle de nómina |
| `transactions` | `transfer_id` | Edición y borrado de traspasos |

Con pocos datos no se nota. Importan sobre todo en los borrados en cascada (Postgres recorre la tabla hija entera si la clave foránea no tiene índice) y en lo que se ejecuta en cada carga de página.

## 3. Modelo de datos

| # | Observación | Propuesta |
|---|---|---|
| 3.1 | Dinero en `double precision`. Decisión documentada en `schema.ts`; los servicios redondean al final y la división de gastos trabaja en céntimos. El riesgo son las comparaciones exactas (`=== 0` en `budgets.service.ts:110`, la clave de deduplicado) | Mantener por ahora. Si se migra: `numeric(14,2)` y un conversor de tipo en el controlador para que llegue como número |
| 3.2 | Fechas como texto (`transactions.date`, `budgets.month`, `start_date`…) sin restricción de formato | Restricciones `CHECK` con expresión regular, o migrar a `date` |
| 3.3 | `transactions.transfer_id` sin clave foránea y con el valor 0 como centinela | Clave foránea a la propia tabla con `ON DELETE SET NULL`, y columna de sentido (punto 1.5) |
| 3.4 | Enumerados solo en TypeScript: en la base de datos son `text` libre | `CHECK (… IN (…))` o tipos `enum` de Postgres |
| 3.5 | Configuración de reglas de alerta y preferencias como JSON en `text` | `jsonb`: permite validar y consultar |
| 3.6 | Sin unicidad de nombres por usuario en cuentas, categorías, etiquetas ni perfiles; el importador empareja por nombre exacto | Índices únicos `(user_id, lower(name))` donde tenga sentido |
| 3.7 | Sin `updated_at` en casi ninguna tabla, ni borrado lógico | `updated_at` en las tablas editables; ayuda a depurar, a sincronizar y a ofrecer «Deshacer» |
| 3.8 | `alert_history` crece sin límite y su índice único `(rule_id, dedupe_key)` no protege cuando `rule_id` es nulo (la regla se borró) | Purgado periódico en el cron (por ejemplo, leídas con más de 12 meses) |
| 3.9 | `accounts.currency` es texto libre de hasta 10 caracteres y no se usa en ningún cálculo | Implementar la conversión o retirar el campo |
| 3.10 | `categories` no tiene `user_id`; la propiedad se resuelve por el grupo | Aceptable; documentarlo, porque obliga a un `JOIN` en cada comprobación |

## 4. Diseño de la API

**4.1. Tres formas de error de validación (M) [V]**
La canónica es `{ error: "texto", details: {...} }`. Pero `routes/profiles.ts:65, 84` y `routes/payslips.ts:288` devuelven `{ error: <objeto> }`, que el frontend pinta como `[object Object]`; `accounts.ts:39-48` cambia la forma de `details`; `budgets.ts` no lo incluye.
*Cambio:* una función `badRequest(res, mensaje, zodError)` y usarla en todas las rutas. Mejor aún, un middleware `validate(schema)` que elimine el bloque repetido.

**4.2. Conmutadores no idempotentes (B)**
`PATCH /accounts/:id/archive` y `PATCH /transactions/:id/clear` invierten el valor sin recibir cuerpo: un reintento de red deshace la acción. `PATCH /recurring-transactions/:id/active` sí recibe el valor.
*Cambio:* aceptar `{ archived }` y `{ cleared }`.

**4.3. Envoltorios de respuesta dispares (B)**
Listas como `{ data }`, como array plano o como `{ data, total, page, limit }` según la ruta. `PUT` es parcial en unas rutas y completo en otras.

**4.4. Rutas ambiguas (B)**
`GET /notes/:payslipId` y `DELETE /notes/:id` comparten forma con parámetros de distinto significado; mejor `/payslips/:id/notes` y `/payslips/:id/tags`. `/finance/by-account` duplica `/accounts`. `GET /accounts/:id` devuelve la cuenta sin saldo y `GET /transactions/:id` la fila sin los nombres que sí trae el listado.

**4.5. Códigos de estado (B)**
`POST /categories/seed-defaults` responde 201 aunque no cree nada; `POST /category-rules` responde 201 al actualizar; `/export` sin datos responde 200 con el texto «Sin datos» incluso si se pidió JSON.

**4.6. Puntos de entrada que faltan (M)**
Se detallan como funcionalidad en `06`, pero la lista técnica es:

- Etiquetas: editar; filtrar nóminas por etiqueta y devolverlas en el listado.
- Notas: editar.
- Alertas: contador de no leídas (el listado corta en 50), paginación y borrado del historial.
- Categorías: reordenar en lote; fusionar; borrar con reasignación.
- Transacciones: acciones en lote para cuenta, fecha, beneficiario y marca; filtros por marca, origen, recurrente, dividido o enlazado a nómina; **saltar una ocurrencia recurrente** (hoy no se puede borrar y, si se pudiera, se regeneraría).
- Importación: deshacer una importación (hace falta un identificador de lote).
- Nóminas: borrado y cambio de tipo en lote; limpieza de `pending` y `error`.
- Cuentas: ajuste de saldo y conciliación.
- Cuenta de usuario: restaurar desde la exportación propia.

**4.7. Sin contrato escrito**
No hay especificación OpenAPI ni tipos compartidos: `frontend/src/lib/api.ts` (1.347 líneas) reescribe a mano los tipos de cada respuesta. Opciones: exportar los esquemas Zod a un paquete compartido del monorepo, o generar OpenAPI desde Zod. Elimina una clase entera de errores (el frontend esperando un campo que el backend ya no envía).

## 5. Deuda de código en el backend

- `routes/transactions.ts` (831 líneas) y `routes/payslips.ts` (564) mezclan validación, acceso a datos y reglas de negocio. Los servicios ya extraídos (división, lote, filtros) muestran el camino: mover creación y edición de transacciones y traspasos a un servicio con pruebas.
- Las rutas repiten el mismo bloque `try { safeParse … } catch (err) { next(err) }`. Express 5 propaga solo los rechazos de promesas; un envoltorio `asyncHandler` hace lo mismo en Express 4.
- `parsers/concept-matcher.ts` (1.047 líneas) conserva la normalización de errores de OCR de la versión retirada. Separar por formato (`type1`, `type2`) con una interfaz común facilitaría añadir formatos; ver `06`, sección del analizador.
- `json2csv` figura en `package.json` pero no se importa en ningún sitio: eliminarlo.
