# 07 · Hoja de ruta propuesta

Ordena todo lo anterior por urgencia y dependencia. Las referencias (`02 §2.1`, `05 §1.4`…) apuntan al fichero y apartado donde está el detalle. Esfuerzo: **S** horas · **M** días · **L** semanas.

## Estado (11/11/2026)

Fases 0 a 3 implementadas en las ramas `fix/fase-0-seguridad` → `fix/fase-1-datos` → `fix/fase-2` → `feat/fase-3` (apiladas, sin publicar). Quedan fuera del código, por hacer a mano:

- **0.1** Comprobar con `curl` si la Data API devolvía filas antes del cambio.
- **0.4** En el panel de Supabase: apagar la Data API, desactivar los proveedores de correo y anónimo, y limitar las Redirect URLs.
- **0.7** Si 0.1 devolvió filas: revisar los logs y valorar la notificación.
- Aplicar las migraciones 0011–0020 en producción (`db:migrate` corre en el build de Vercel de producción).

La fase 4 sigue pendiente de decisiones de producto.

## Fase 0 — Hoy (seguridad, menos de un día)

| # | Tarea | Ref. | Esf. |
|---|---|---|---|
| 0.1 | Comprobar con `curl` si la Data API devuelve filas | `01 §3` | S |
| 0.2 | Activar RLS en las 18 tablas (migración + SQL Editor) | `01 §4.1` | S |
| 0.3 | Retirar privilegios a `anon` y `authenticated` | `01 §4.2` | S |
| 0.4 | Apagar la Data API; desactivar proveedor de correo y accesos anónimos | `01 §4.3, §6` | S |
| 0.5 | `npm audit fix` (sin `--force`), tests y build | `08 §1.4` | S |
| 0.6 | `isEvalSupported: false` en pdfjs | `08 §1.2` | S |
| 0.7 | Si 0.1 devolvió filas: revisar logs y valorar la notificación | `01 §7` | — |

## Fase 1 — Esta semana (errores que pierden o falsean datos)

| # | Tarea | Ref. | Esf. |
|---|---|---|---|
| 1.1 | Validación real de fechas y meses en un esquema compartido; `try/catch` por usuario en el cron; alertas independientes de recurrentes | `02 §2.1, §3.1` | M |
| 1.2 | Liquidar un traspaso actualiza las dos patas | `03 §1.1` | S |
| 1.3 | La edición de nóminas deja de inventar bruto 0 y el mes actual | `04 §1.2` | S |
| 1.4 | La edición no se pierde al cambiar de ventana | `04 §1.1` | S |
| 1.5 | Confirmación al reprocesar; marca `manually_edited` | `03 §1.3`, `04 §1.3` | M |
| 1.6 | «Quitar categoría» deja de ser la acción por defecto en lote | `05 §1.4` | S |
| 1.7 | Borrar categoría o grupo: mostrar alcance y ofrecer reasignación | `05 §1.1`, `03 §1.7` | M |
| 1.8 | Sacar `GET /auth/me` del límite de autenticación; una sola consulta `me` | `04 §1.5` | S |
| 1.9 | Middleware de autenticación: separar 401 de 503; alta con `ON CONFLICT` | `02 §2.4` | S |
| 1.10 | Estado de error en el detalle de nómina | `04 §1.4` | S |
| 1.11 | Claves que faltan en `invalidateFinance`; «Actividad reciente» con fecha máxima hoy | `05 §1.3, §1.7` | S |
| 1.12 | «Hoy» en hora de Madrid | `03 §1.4` | S |

## Fase 2 — Este mes (red de seguridad y fricción diaria)

**Red de seguridad**

| # | Tarea | Ref. | Esf. |
|---|---|---|---|
| 2.1 | Integración continua: tipos, tests, build y audit en cada PR | `08 §2` | S |
| 2.2 | Pruebas de autorización entre dos usuarios para cada recurso | `08 §2`, `02 §3.2` | M |
| 2.3 | Cabeceras de seguridad y CSP (primero en modo informe) | `02 §2.2` | M |
| 2.4 | Escapado de fórmulas en CSV | `02 §2.3` | S |
| 2.5 | Importes acotados; eliminar `/transactions/bulk`; topes por usuario | `02 §2.7` | M |
| 2.6 | Borrado de cuenta atómico, limpieza de caché, service role obligatoria en producción | `02 §2.5, §2.6` | S |
| 2.7 | Índices en claves foráneas | `03 §2` | S |
| 2.8 | Monitorización de errores y alerta si falla el cron | `08 §3.8` | S |
| 2.9 | README, `.env.example` y `AGENTS.md` al día; eliminar `old/` | `08 §5, §6` | S |
| 2.10 | Actualizar `drizzle-orm`, `multer`; quitar `json2csv` | `08 §1.1` | M |

**Fricción diaria**

| # | Tarea | Ref. | Esf. |
|---|---|---|---|
| 2.11 | Navegación sin recarga completa (`prefetch`, luego `ClientRouter`) | `04 §1.6` | M |
| 2.12 | Sin esqueleto de página entera al cambiar filtros o mes | `05 §1.2` | S |
| 2.13 | «Deshacer» en borrados y acciones en lote | `05 §1.5` | M |
| 2.14 | Filtros, orden y página en la URL en todas las pantallas; botón Atrás en el detalle | `04 §3`, `05 §2, §4, §7` | M |
| 2.15 | Retardo en las búsquedas | `04 §3.3`, `05 §2.7` | S |
| 2.16 | Mensajes de error siempre en español (`ApiError`) y forma única de error en la API | `04 §7.4`, `03 §4.1` | M |
| 2.17 | Botones invisibles o diminutos en táctil | `05 §1.6`, `04 §8.6` | S |
| 2.18 | Comparaciones con el mes en curso | `05 §1.10` | S |
| 2.19 | Glosario único y plurales | `05 §10` | S |
| 2.20 | Guardia de sesión, destino tras el login, errores de Google | `04 §7.1-7.3` | M |
| 2.21 | Subida: duplicados visibles, aviso al salir, perfil bloqueado durante la tanda | `04 §2` | M |
| 2.22 | Nóminas `pending` zombis y duplicados que cuentan doble | `03 §1.13, §1.14` | M |

## Fase 3 — Este trimestre (funcionalidad que cambia el producto)

Ordenadas por la relación entre valor y esfuerzo.

| # | Tarea | Ref. | Esf. |
|---|---|---|---|
| 3.1 | Reglas de alerta por defecto y anomalías convertidas en alertas | `06 C1, C2` | S |
| 3.2 | Ahorro real y vínculo nómina ↔ ingreso en los dos sentidos | `06 E1, E2, C3` | S |
| 3.3 | Clasificación semántica de conceptos | `06 A3` | M |
| 3.4 | Corrección manual completa, con el PDF a la vista | `06 A1, A2` | M |
| 3.5 | Conciliación de cuentas | `06 D1` | M |
| 3.6 | Importación con vista previa real y vuelta atrás | `06 D3`, `05 §1.9` | M |
| 3.7 | Importación genérica de extractos bancarios | `06 D2` | L |
| 3.8 | Comparar nóminas; resumen anual y vista para la Renta | `06 A4, A5` | M |
| 3.9 | Reglas de categorización más ricas y gestión de beneficiarios | `06 D5, D6` | M |
| 3.10 | Presupuesto: mover dinero, saldos iniciales, fila sin categoría | `06 D7` | M |
| 3.11 | Partir `FinanceAnalyticsPage` y `TransactionsPage`; `lib/dates.ts` | `05 §11` | M |
| 3.12 | Accesibilidad: teclado en grupos de opciones, gráficos como tabla, calendario | `04 §8`, `05 §8` | M |
| 3.13 | Peso del frontend: solo `auth-js`, carga diferida de gráficos y diálogo | `04 §9` | M |
| 3.14 | Exportación completa con restauración | `06 F1` | M |
| 3.15 | Arquitectura de formatos del analizador y métricas de calidad | `06 B1, B4` | L |

## Fase 4 — Más adelante (requieren decisión de producto)

| Tarea | Ref. | Qué hay que decidir |
|---|---|---|
| Analizador asistido por modelo de lenguaje | `06 B2` | Enviar texto de nóminas a un tercero; opcional o no |
| PDF escaneados | `06 B3` | OCR en el navegador o no admitirlos |
| Sincronización bancaria | `06 D4` | Proveedor, coste, responsabilidad |
| Presupuesto compartido | `06 D15` | Cambio del modelo de autorización |
| Multidivisa | `06 D13` | Implementar o retirar |
| Alertas por correo o push | `06 C4` | Proveedor de correo |
| Plan Pro | `06 F10` | Qué se cobra |
| Dominio propio | `06 F8` | Nombre |
| Migración de dinero a `numeric` y fechas a `date` | `03 §3` | Coste de migración frente al riesgo actual |
| Astro 7, zod 4, pdfjs 5 | `08 §1` | Ventana para cambios mayores |

## Dependencias entre tareas

- **Todo lo que añada datos sensibles o usuarios** (sincronización bancaria, plan de pago, presupuesto compartido) va **después** de la Fase 0, de las pruebas de autorización (2.2) y de las cabeceras (2.3).
- **«Deshacer»** (2.13) es mucho más fácil con `updated_at` y un registro de actividad (`06 F9`); si se van a hacer ambos, primero el registro.
- **Clasificación semántica** (3.3) va antes de comparar nóminas, de la vista para la Renta y de la inteligencia sobre IRPF.
- **Conciliación** (3.5) va antes de sincronización bancaria: sin ella no hay forma de saber si la sincronización cuadra.
- **Navegación sin recarga** (2.11) cambia el ciclo de vida de las islas: conviene hacerla antes de invertir en persistencia de filtros (2.14), porque parte del problema desaparece.
- **Partir los componentes grandes** (3.11) antes de añadir funcionalidad a Analítica o Transacciones.
