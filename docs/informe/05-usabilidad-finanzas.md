# 05 · Usabilidad: módulo de finanzas

Auditoría por lectura de código (no se ejecutó la app). **[V]** verificado · **[S]** sospecha. Rutas relativas a `frontend/src/`. Prioridad **A/M/B**.

Un dato condiciona varias conclusiones: cada página es una carga completa (ver `04`, punto 1.6), así que la caché de consultas se pierde al navegar. Los fallos de refresco de datos solo importan dentro de una misma pantalla.

## Inventario de pantallas

| Pantalla | Fichero | Qué permite |
|---|---|---|
| Inicio | `components/HomeDashboardPage.tsx` | KPI, flujo de caja de 12 meses, última nómina, movimientos recientes, cuentas |
| Resumen | `components/FinanceDashboardPage.tsx` | Periodo y cuenta; KPI; flujo mensual; reparto por categoría; beneficiarios; evolución del saldo; previsión a 90 días |
| Transacciones | `components/TransactionsPage.tsx` + `finance-manage/transactions/*` | Filtros en URL, orden, paginación de 50; editar, liquidar, dividir, duplicar, programar, eliminar; selección múltiple; exportar; pestaña de recurrentes y sugerencias de suscripciones |
| Presupuesto | `components/BudgetPage.tsx` + `budget/*` | Asignar por mes, asignación rápida, objetivos, cubrir sobregasto |
| Informe del mes | `components/FinanceReportPage.tsx` | Totales frente al mes anterior, subidas y bajadas, gastos inusuales, sitios nuevos |
| Analítica | `components/FinanceAnalyticsPage.tsx` + `finance/*` | 19 paneles configurables, comparación con periodo anterior, vistas guardadas, exportar PNG/CSV |
| Cuentas | `components/AccountsPage.tsx` | Alta, edición, archivado, borrado |
| Categorías | `components/CategoriesPage.tsx` + `categories/*` | Grupos, categorías y reglas «beneficiario contiene → categoría» |
| Importar | `components/ImportPage.tsx` | CSV/TSV de YNAB en tres pasos |

Estado en la URL: Transacciones guarda los filtros (pero no orden, página ni pestaña) e Informe guarda el mes. Presupuesto, Analítica, Resumen y Cuentas no guardan nada.

## 1. Los diez problemas que más se notan

### 1.1. Borrar una categoría o un grupo destruye datos sin avisar — A [V]

El diálogo solo dice «Esta acción no se puede deshacer» (`CategoriesPage.tsx:552-560`). Lo que ocurre de verdad: los movimientos quedan sin categoría, se borran las asignaciones de presupuesto y los objetivos, se borran las reglas asociadas, y borrar un grupo arrastra todas sus categorías. Además el presupuesto queda descuadrado (ver `03`, punto 1.7). Los mensajes de error dicen «puede tener transacciones asignadas», cuando eso no impide el borrado.

**Cambio:** mostrar el alcance («42 movimientos, 6 meses de presupuesto, 2 reglas») y ofrecer «Mover sus movimientos a…».

### 1.2. Cada cambio de filtro o de mes sustituye la página entera por el esqueleto — A [V]

`FinanceAnalyticsPage.tsx:256-259, 598`; `FinanceDashboardPage.tsx:80-83, 134`; `FinanceReportPage.tsx:336`; `BudgetPage.tsx:154-162`. Se desmonta incluso la cabecera con los filtros: se pierde el foco y en Presupuesto no se puede pulsar «mes anterior» varias veces seguidas. El indicador «Actualizando…» que existe casi nunca llega a verse.

**Cambio:** `placeholderData: (prev) => prev` en esas consultas, cabecera siempre montada y atenuar solo los paneles.

### 1.3. Tras algunas operaciones quedan cifras antiguas en pantalla — A [V]

`lib/finance-cache.ts` centraliza qué se refresca tras tocar un movimiento, pero le faltan tres claves: `finance-daily` (gráficos de ritmo y calendario), `finance-amounts` (distribución de importes) y `recurring-transactions`. Y las operaciones sobre reglas recurrentes (`TransactionsPage.tsx:258-262`) no usan esa función, aunque crear una regla genera movimientos: los saldos de las cuentas y «Sin liquidar» quedan viejos.

**Cambio:** añadir las tres claves y usar `invalidateFinance` también en recurrentes e importación.

### 1.4. En el diálogo de categorizar en lote, la acción por defecto es «Quitar categoría» — A [V]

`finance-manage/transactions/BulkActionBar.tsx:82-97`: con el selector vacío (su estado inicial), el botón principal dice «Quitar categoría». Un clic borra la categoría de todos los movimientos seleccionados, sin confirmación.

**Cambio:** botón principal desactivado hasta elegir categoría; «Quitar categoría» como acción secundaria con confirmación.

### 1.5. No hay «Deshacer» en ninguna acción destructiva — A [V]

Eliminar, acciones en lote y unir partes (`TransactionsPage.tsx:178-202, 240-247`) muestran avisos puramente informativos.

**Cambio:** aviso con acción «Deshacer» que restaure lo borrado o el estado anterior. Es la mejora de confianza con mejor relación entre coste y efecto de todo el módulo.

### 1.6. El botón de objetivo del presupuesto es invisible en pantallas táctiles — A [V]

`budget/BudgetTable.tsx:128` lo oculta (`opacity-0`) salvo al pasar el ratón, mientras la propia página indica «Pulsa ◎ junto a una categoría».

**Cambio:** visible siempre en móvil, o siempre visible y tenue.

### 1.7. «Actividad reciente» de Inicio puede salir vacía habiendo movimientos — A [V]

`HomeDashboardPage.tsx:237-240` pide los 10 movimientos más recientes por fecha y después descarta los programados (`:296`). Las ocurrencias futuras de las reglas recurrentes ya están generadas y ocupan los primeros puestos.

**Cambio:** pedir con fecha máxima hoy.

### 1.8. Las preferencias pueden revertirse solas — M [V]

`hooks/use-preference.ts:61-91`: el valor del servidor siempre gana a la copia local, el guardado se retrasa 600 ms sin vaciarse al salir de la página, y los fallos se ignoran. Cambiar un ajuste y navegar enseguida hace que la siguiente carga restaure el valor antiguo.

**Cambio:** vaciar el guardado pendiente en `pagehide` (con `keepalive`) y marcar la copia local como pendiente de sincronizar.

### 1.9. La importación se revisa a ciegas y no se puede deshacer — A [V]

`ImportPage.tsx:59-87`: la «revisión» son cuatro contadores. No se ven las filas, ni qué cuentas se van a crear, ni cuáles se descartan (importe cero o cuenta desconocida se saltan en silencio). No se puede asignar una cuenta de YNAB a una existente (se casa por nombre exacto). El contador «Transacciones» significa una cosa en la revisión y otra en el resultado. Y una vez importado, no hay vuelta atrás.

**Cambio:** vista previa por filas con estado (nueva, duplicada, descartada y por qué), mapeo de cuentas, «N nuevas · M ya existentes», e identificador de lote con «Deshacer importación».

### 1.10. Comparaciones engañosas con el mes en curso — M [V]

`FinanceDashboardPage.tsx:40-49`; `HomeDashboardPage.tsx:250-252, 329, 335`: los indicadores de variación comparan el mes actual, a medias, con un mes completo. A día 5 se ve «−80 %» en verde o rojo. En Inicio, además, si el mes actual aún no tiene movimientos, el «mes anterior» pasa a ser el de hace dos meses. La Analítica y el Informe sí tratan bien el mes parcial.

**Cambio:** comparar los dos últimos meses completos, o el mes en curso contra el mismo tramo del anterior.

## 2. Transacciones

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 2.1 | M | Marcar un movimiento como liquidado atenúa toda la tabla; sin estado pendiente, un doble clic lanza dos peticiones | `TransactionsPage.tsx:249-256, 815`; `TransactionTable.tsx:121` | Actualización optimista; atenuar solo al cambiar filtros o página |
| 2.2 | M | La pata de entrada de un traspaso no se puede editar; filtrando por la cuenta destino solo se ve esa | `TransactionsPage.tsx:331-335` | Abrir el formulario de la pata de salida |
| 2.3 | M | «Nueva transacción» con la tecla N ignora la cuenta filtrada | `AppShell.tsx:591-596` | Leer `?cuenta=` de la URL |
| 2.4 | M | Dividir: sin nota por parte (la API la admite), sin edición posterior, y «Unir» se ejecuta sin confirmar | `SplitDialog.tsx:73`; `TransactionsPage.tsx:853` | Nota, «Editar división» y confirmación |
| 2.5 | M | «Liquidar con otro importe» no deja cambiar la fecha, y el cargo real suele llegar otro día | `SettleDialog.tsx:30-39` | Campo de fecha |
| 2.6 | M | La selección se limita a la página visible: con 300 gastos sin categoría hay que repetir seis veces | `TransactionsPage.tsx:121` | «Seleccionar los N que coinciden con el filtro» |
| 2.7 | M | La búsqueda lanza una petición y reescribe la URL en cada tecla | `TransactionsPage.tsx:671` | Retardo de 300 ms |
| 2.8 | M | Orden, página y pestaña no van a la URL; el enlace «Programar» de la previsión cae en la pestaña equivocada | `TransactionsPage.tsx:103, 113-114`; `ForecastCard.tsx:80` | `?orden=`, `?pagina=`, `?vista=recurrentes` |
| 2.9 | M | `?buscar=` se borra de la URL al cargar pero sigue aplicado: el campo muestra el texto y la URL no | `TransactionsPage.tsx:318-329` | Eliminar ese efecto |
| 2.10 | M | Los enlaces desde los rankings de beneficiarios usan búsqueda por subcadena: «Amazon» trae también «Amazon Prime» y el total no cuadra | `FinanceAnalyticsPage.tsx:381-383`, `FinanceDashboardPage.tsx:118-120`, `FinanceReportPage.tsx:197, 221` | Filtro `beneficiario=` exacto (la API ya lo admite) |
| 2.11 | M | Tras borrar el último elemento de la última página se muestra «Aún no hay transacciones» y «101–100 de 100» | `TransactionsPage.tsx:455-456, 868` | Retroceder de página si se supera el total |
| 2.12 | M | El neto del día se calcula solo con las filas de la página; un día partido entre dos páginas muestra un neto parcial, y suma pendientes y programados | `TransactionTable.tsx:56-58, 192-203` | Calcularlo en el servidor o indicar que es parcial |
| 2.13 | M | Exportar no muestra carga ni errores | `TransactionsPage.tsx:433` | Estado y aviso |
| 2.14 | M | En móvil, editar requiere doble toque sin ninguna pista, no hay botón de liquidar en la fila y la nota no se muestra | `TransactionTable.tsx:351-386` | Un toque abre el detalle; botón de liquidar visible |
| 2.15 | B | Sin selección por rango (Mayús+clic); no se puede duplicar ni programar un traspaso; el borrado individual no avisa de que un traspaso borra sus dos patas | `TransactionsPage.tsx:302, 856, 994` | — |
| 2.16 | B | Los periodos predefinidos guardan fechas absolutas: un marcador de «Este mes» deja de serlo al cambiar de mes | `lib/transaction-filters.ts:108-131` | `?periodo=este-mes` |
| 2.17 | B | Rangos invertidos (fecha o importe) sin validar | `TransactionsPage.tsx:748-762`; `AmountRangeFilter.tsx:29-33` | Validar o intercambiar |
| 2.18 | B | «Ahorras el −20 %» con balance negativo | `TransactionsPage.tsx:632` | Texto alternativo |
| 2.19 | B [S] | Coma decimal en campos `type="number"`: según navegador, «12,50» puede rechazarse | `TransactionDialog.tsx:143`, `RecurringDialog.tsx:69`, `AccountsPage.tsx:145` | `type="text" inputMode="decimal"` con conversión propia, que además permitiría operaciones como «12,5+3» |
| 2.20 | B [S] | El pie del diálogo puede quedar fuera de pantalla en móvil | `TransactionDialog.tsx:123` (`90vh` dentro de una hoja de `92svh`) | Unidades `dvh` |

## 3. Recurrentes y suscripciones

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 3.1 | M | No hay traspasos recurrentes: el ahorro mensual automático no se puede programar | `RecurringDialog.tsx:15, 41` | Admitir el tipo traspaso |
| 3.2 | M | «N vencidas» es texto: no lleva a esos movimientos ni permite liquidarlos de una vez | `RecurringRuleCard.tsx:78-88` | Filtro por regla y «Liquidar todas las vencidas» |
| 3.3 | M | Eliminar o pausar una regla no explica qué pasa con sus ocurrencias pendientes | `TransactionsPage.tsx:1003` | Decirlo en el diálogo |
| 3.4 | M | No se puede saltar una ocurrencia concreta (un mes que no se cobra el gimnasio) | La API no lo permite, ver `03` 4.6 | «Saltar esta vez» |
| 3.5 | B | El formulario de regla es más pobre que el de transacción: beneficiario sin autocompletar, intervalo máximo 12, sin validar que el fin sea posterior al inicio | `RecurringDialog.tsx:84, 119-122, 136` | Igualarlos |
| 3.6 | B | Las sugerencias de suscripción no se pueden descartar y solo detectan cadencia mensual | `SubscriptionSuggestions.tsx:27-36` | «No es una suscripción»; cadencia anual |

## 4. Presupuesto

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 4.1 | M | El mes no va a la URL y no hay botón «Hoy» | `BudgetPage.tsx:52` | Como ya hace el Informe |
| 4.2 | M | Solo se puede mover dinero para cubrir un sobregasto, no libremente entre categorías | `BudgetPage.tsx:119` | «Mover dinero…» desde cualquier disponible |
| 4.3 | M | Textos «este mes» fijos al ver otros meses | `BudgetPage.tsx:188-192, 231` | Nombre del mes |
| 4.4 | B | La celda de asignado admite negativos, y vaciarla asigna 0 | `BudgetTable.tsx:35-38, 55-58` | Validar; vaciar = cancelar |
| 4.5 | B | En móvil no hay totales de grupo | `BudgetPage.tsx:266` | Mostrarlos compactos |
| 4.6 | B | Los gastos sin categoría no aparecen en Presupuesto, aunque afectan al dinero disponible | — | Fila «Sin categoría» con enlace |
| 4.7 | B | El objetivo «para una fecha» no muestra progreso, solo texto | `BudgetTable.tsx:161-181` | Barra |
| 4.8 | B | «Cerca del límite» se indica solo con color | `lib/budget-progress.ts:33` | Icono o texto |
| 4.9 | B | Redondeo a la baja con coma flotante: 1,15 se convierte en 1,14 | `budget/CoverDialog.tsx:59, 66` | Redondear antes |
| 4.10 | B | No se explica de dónde sale «Para presupuestar» (ver `03`, 1.8: no incluye saldos iniciales) | — | Desglose al pulsar la cifra |

## 5. Categorías y reglas

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 5.1 | M | «Aplicar a mis gastos sin categoría» recategoriza todo sin vista previa ni deshacer | `categories/CategoryRulesCard.tsx:55-73` | «Se categorizarán 87 movimientos» con lista y confirmación |
| 5.2 | M | Reglas mínimas: solo «el beneficiario contiene»; no se editan, no tienen prioridad, no dicen a cuántos movimientos afectan; no hay «crear regla» desde el menú de un movimiento | `lib/api.ts:1206-1214` | Ver `06` |
| 5.3 | M | No se pueden reordenar categorías ni grupos, ni elegir icono de grupo, aunque los campos existen | `lib/api.ts:606-634`; `CategoriesPage.tsx:130` | Reordenar con flechas, como en cuentas |
| 5.4 | B | Tras renombrar, mover o borrar no se refrescan la actividad ni las reglas | `CategoriesPage.tsx:266` | Invalidar ambas |
| 5.5 | B | Para pintar las barras de actividad se descarga la analítica completa | `CategoriesPage.tsx:252-255` | Punto de entrada ligero |

## 6. Cuentas

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 6.1 | M | Las tarjetas de cuenta no enlazan a sus movimientos y solo muestran el saldo liquidado | `AccountsPage.tsx:177-234` | Enlace y desglose (liquidado, pendiente, previsto) |
| 6.2 | M | Borrar una cuenta elimina sus movimientos y deja medios traspasos en las demás (ver `03`, 1.6) | — | Avisar del alcance; recomendar archivar |
| 6.3 | B | Reordenar cuentas se hace desde Transacciones, no desde Cuentas; las archivadas no se ordenan | `TransactionsPage.tsx:559-573` | Ofrecerlo en ambas |
| 6.4 | B | «Sin movimientos» se muestra cuando el neto es cero, que no es lo mismo | `AccountsPage.tsx:188, 223` | Contar movimientos |
| 6.5 | B | El contador de cuentas de Inicio incluye archivadas | `HomeDashboardPage.tsx:321` | Excluirlas |
| 6.6 | B | La moneda se muestra, pero el formulario no la pide y nada la usa | `AccountsPage.tsx:51-58, 204` | Implementar u ocultar |

## 7. Analítica, resumen, informe y previsión

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 7.1 | M | Los filtros de Analítica y Resumen no van a la URL: no se pueden compartir ni marcar | `FinanceAnalyticsPage.tsx:155-160` | Sincronizar |
| 7.2 | M | Las vistas guardadas solo guardan filtros, no el diseño ni «Comparar»; no se renombran ni sobrescriben y se borran sin confirmar | `lib/analytics-settings.ts:209-219`; `AnalyticsViewsMenu.tsx:74` | Guardar el estado completo; «Actualizar vista» |
| 7.3 | M | Sin movimientos en el periodo se ocultan todos los paneles, también los que no dependen de él | `FinanceAnalyticsPage.tsx:1588-1597` | Ocultar por panel |
| 7.4 | M | Los porcentajes de «Distribución» son sobre los N primeros, no sobre el total, y se exportan como «% del total» | `FinanceAnalyticsPage.tsx:369-370, 1136` | Usar el porcentaje del servidor o añadir «Otras» |
| 7.5 | M | «Tendencia por categoría» apilada omite el resto de categorías | `FinanceAnalyticsPage.tsx:391-393` | Fila «Otras», como en la cascada |
| 7.6 | M | La evolución del saldo del Resumen es incorrecta con una cuenta filtrada: se reconstruye restando netos mensuales que excluyen traspasos | `FinanceDashboardPage.tsx:90-91` | Usar el histórico de saldos del servidor |
| 7.7 | M | La previsión ignora el filtro de cuenta; horizonte fijo de 90 días; lista limitada a 6; los «Atrasado» no son accionables | `FinanceDashboardPage.tsx:376-377`; `ForecastCard.tsx:18, 84-86` | Pasar la cuenta; horizonte elegible |
| 7.8 | M | El informe no se puede exportar ni imprimir, y la tabla se corta en 10 categorías | `FinanceReportPage.tsx:124` | «Ver todas» y hoja de estilos de impresión |
| 7.9 | B | 20 paneles que se reordenan de uno en uno | `AnalyticsCustomizeSheet.tsx:58-77` | Arrastrar, manteniendo las flechas |
| 7.10 | B | «Series apiladas: N» en lecturas rápidas no aporta nada | `FinanceAnalyticsPage.tsx:1520-1524` | Quitar |
| 7.11 | B | En Inicio, un traspaso entrante se rotula «Traspaso a X» y sin signo | `HomeDashboardPage.tsx:140, 144` | «Desde / Hacia» |
| 7.12 | B | El acceso «Analítica» de Inicio lleva a la de nóminas y el enlace del gráfico contiguo a la de finanzas; «Crear cuenta» de primeros pasos no abre el diálogo | `HomeDashboardPage.tsx:227, 369`; `GettingStartedCard.tsx:57` | Unificar destinos |

## 8. Accesibilidad

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 8.1 | A | El calendario de calor crea hasta ~370 paradas de tabulación con celdas de 14 px | `charts/CalendarHeatmap.tsx:53, 81-93` | Patrón de rejilla con foco itinerante y flechas |
| 8.2 | M | Los gráficos no tienen alternativa accesible; los datos ya existen para exportar | `FinanceAnalyticsPage.tsx:736-743` | «Ver como tabla» |
| 8.3 | M | Grupos de opciones sin teclado de flechas | `app/Segmented.tsx`, `ColorSwatches.tsx:20-40`, `AccountsPage.tsx:115-136` | Igual que en `04`, 8.1 |
| 8.4 | M | Cabeceras ordenables sin `aria-sort` | `TransactionTable.tsx:163-181` | Añadirlo |
| 8.5 | M | Rojo y verde fijos en cascada, presupuesto frente a real y diagrama de flujo: ignoran la paleta para daltonismo que la app ofrece | `charts/WaterfallChart.tsx:16`, `BudgetVsActualChart.tsx:54, 59`, `SankeyChart.tsx:16` | Variables de tema |
| 8.6 | B | Pulsar una barra del gráfico no tiene equivalente de teclado | `FinanceDashboardPage.tsx:163-165` | Lista de meses con enlaces |
| 8.7 | B | La barra de acciones en lote en móvil son cinco iconos sin texto | `BulkActionBar.tsx:51-65` | Etiquetas o menú |

**Lo que ya está bien:** signo además de color en los importes, flecha además de color en los indicadores de variación, barras de progreso con texto accesible, etiquetas en formularios, errores con `role="alert"`, y flechas como alternativa al arrastre en la reordenación de cuentas.

## 9. Rendimiento

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 9.1 | A | `FinanceAnalyticsView` es un único componente de ~1.470 líneas que reconstruye todos los paneles en cada render; cambiar un control repinta todos los gráficos | `FinanceAnalyticsPage.tsx:153-1624` | Un componente memoizado por panel; un `useAnalyticsSettings` |
| 9.2 | M | Todos los paneles visibles piden datos al cargar (unas 10 peticiones con «Comparar») | `:1599-1605` | Montar al entrar en pantalla |
| 9.3 | M | Tabla de escritorio y lista móvil se renderizan a la vez y se ocultan con CSS: 100 filas y 100 menús por página | `TransactionTable.tsx:207, 335` | Renderizar una según el ancho |
| 9.4 | M | «Primeros pasos» lanza dos consultas en cada visita al Resumen aunque ya esté completado u oculto | `GettingStartedCard.tsx:38-43` | `enabled: !dismissed` |
| 9.5 | B | Inicio hace 7-8 peticiones, incluida la tendencia de todo el histórico para pintar 12 meses | `HomeDashboardPage.tsx:232-244, 267` | Acotar el rango; un punto de entrada agregado |
| 9.6 | B | `TransactionsView` concentra unos 20 estados y 12 mutaciones; cualquier cambio repinta la tabla | `TransactionsPage.tsx:98-1011` | Ver sección 11 |

## 10. Textos y coherencia

- **M — Tres nombres para lo mismo.** «Transacciones» (título), «Movimientos» (pestaña y avisos) y «Transacción eliminada». Para traspasos: «Transferencia», «Traspaso», «Mover entre cuentas» y «Movimiento entre cuentas». Para el estado: «Liquidada», «Pendiente», «Prevista», «Por liquidar», «Sin liquidar». Hace falta un glosario único y aplicarlo. Sugerencia: *movimiento*, *traspaso*, *liquidado / pendiente / programado*.
- **B — Plurales:** «1 cuentas», «1 meses», «1 grupos · 1 categorías» (`FinanceDashboardPage.tsx:206`, `FinanceAnalyticsPage.tsx:1423`, `ImportPage.tsx:62`). Una función `plural(n, "cuenta", "cuentas")`.
- **B — «Beneficiario» también para ingresos** (`TransactionDialog.tsx:104`); la analítica dice «Orígenes». Usar «Pagador» u «Origen» cuando el tipo es ingreso.
- **B — Concordancia:** «seleccionadas» frente a «movimientos» (`BulkActionBar.tsx:48`).
- **B — Formato:** «2.5k» con punto en ejes (`charts/AmountsChart.tsx:22`); `Math.round` en lugar de `formatPct`.
- **B — Dos estilos de diálogo:** con cabecera y pie bordeados en Transacciones y Cuentas; sin ellos en Categorías. El botón de guardar de Cuentas no muestra «Guardando…».
- **B — «Importar sin revisar»** está al lado de «Revisar» con el mismo peso (`ImportPage.tsx:239-248`); rebajarlo a enlace.

## 11. Refactorizaciones que desbloquean mejoras de uso

| Qué | Dónde | Qué permite |
|---|---|---|
| `lib/dates.ts` y un `<MonthSwitcher>` común | El selector de mes está en tres ficheros; `currentMonth`/`shiftMonth`/`monthLabel` en cinco; la fecha local en ISO en al menos siete; nombres de mes en seis | Resuelve de una vez 4.1, 4.3 y la coherencia de fechas |
| Partir `FinanceAnalyticsPage.tsx` | Ajustes `:164-243` → gancho; derivaciones `:304-527` → funciones puras con pruebas; cada gráfico `:665-1042` → componente; cabecera `:1416-1505` | 9.1, 9.2 y poder probar los cálculos |
| Partir `TransactionsPage.tsx` | Pestaña de recurrentes `:886-925`; barra de filtros `:664-812`; chips de cuenta `:524-573`; mutaciones `:178-256` | 2.1, 9.6 |
| Unificar duplicados | Dos `AccountSelect` distintos, dos `LegendDot`, iconos por tipo de cuenta en tres sitios, cálculo de variación porcentual en cuatro | Coherencia visual |
| `lib/api.ts` | Cinco copias del mismo armado de parámetros (`:1039-1077`) con la función ya escrita en `:1325-1333`; filtros duplicados entre listado y exportación | Menos errores al añadir filtros |
| Función `errorMessage(e, alternativa)` | Hoy unas pantallas muestran `HTTP 500` y otras descartan el mensaje útil del servidor | Mensajes consistentes |
