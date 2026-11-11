# 04 · Usabilidad: nóminas, navegación, sesión y páginas públicas

Auditoría por lectura de código (no se ejecutó la app en un navegador). Cada punto indica **[V]** verificado en el código citado o **[S]** sospecha que depende del entorno o que no se pudo confirmar. Las rutas son relativas a `frontend/src/` salvo que se indique.

Prioridad: **A** alta · **M** media · **B** baja.

## Inventario de pantallas

| Ruta | Componente | Qué permite |
|---|---|---|
| `/`, `/caracteristicas`, `/precios`, `/privacidad`, `/aviso-legal`, `/cookies` | páginas `.astro` | Sitio público |
| `/login` | `LoginPage` | «Continuar con Google» |
| `/app` | `HomeDashboardPage` | Saludo, primeros pasos, resumen mixto |
| `/app/payroll` | `DashboardPage` | KPI, evolución bruto/neto, IRPF, resumen anual, tabla de conceptos, varios perfiles, rango |
| `/app/upload` | `UploadPage` | Perfil y tipo, arrastrar PDF (máx. 4 MB), cola, reintento, aviso de duplicado |
| `/app/payslips` | `PayslipsPage` + `payroll/PayslipDetail` | Lista con búsqueda, filtros, orden y paginación; detalle con edición, reprocesado, etiquetas, notas, vínculo con ingreso |
| `/app/analytics` | `AnalyticsPage` | Evolución, interanual, proyección, por concepto, anomalías, pagas extra |
| `/app/profiles` | `ProfilesPage` | Alta, edición y baja de perfiles |
| `/app/alerts` | `AlertsPage` | Reglas (nóminas y finanzas) e historial |
| `/app/settings` | `SettingsPage` | Nombre, tema, paleta, exportar, cerrar sesión, eliminar cuenta |
| Todo `/app/*` | `AppShell`, `CommandMenu`, `MobileTabBar` | Barra lateral, selector de espacio, ⌘K, campana, atajo `N` |

No existe página 404 propia.

## 1. Los seis problemas que más se notan

### 1.1. Se pierde la edición de una nómina al cambiar de ventana — A [V]

`components/PayslipsPage.tsx:250` monta el detalle con `key={`${detail.id}-${dataUpdatedAt}`}`. La consulta hereda `staleTime` de 30 s y el refresco al recuperar el foco (`lib/query-client.ts`). Secuencia real: pulsas «Editar», cambias de ventana para mirar el PDF original (la app no lo guarda, así que es lo normal), vuelves pasados 30 segundos, la consulta se refresca, cambia la `key`, el componente se remonta y la edición desaparece sin aviso.

**Cambio:** `refetchOnWindowFocus: false` en esa consulta mientras se edita; remontar solo tras guardar o reprocesar (contador propio en lugar de `dataUpdatedAt`); aviso al salir con cambios sin guardar.

### 1.2. Guardar una edición puede escribir datos inventados — A [V]

`components/payroll/PayslipDetail.tsx:492-498` inicializa el formulario con `grossSalary ?? 0`, `netSalary ?? 0` y, si la nómina no tenía periodo, el **mes y año actuales**. Al guardar se envían siempre. Resultado: una nómina «sin periodo» pasa a ser del mes en curso, un bruto desconocido pasa a 0 € y entra en las medias, y el backend la marca como `parsed`.

Relacionado (`PayslipDetail.tsx:100, 654, 658, 662`): los campos numéricos usan `Number(e.target.value)`, de modo que no se pueden vaciar (vuelven a 0), y un año vacío lo rechaza el servidor con un aviso genérico.

**Cambio:** estado `number | ""`, enviar solo los campos válidos, obligar a elegir periodo si falta, errores por campo (como ya hace `AlertsPage.tsx:208-222`) e `inputMode="decimal"`.

### 1.3. «Reprocesar» borra las correcciones manuales sin preguntar — A [V]

`PayslipDetail.tsx:604` llama directamente a `onReprocess`. El backend borra los conceptos y los vuelve a generar desde `rawText`, así que todo lo corregido a mano se pierde.

**Cambio:** confirmación explícita («se sustituirán los conceptos actuales, incluidas tus correcciones») o aviso con «Deshacer». Mejor aún: marcar los conceptos editados a mano y conservarlos al reprocesar.

### 1.4. Un enlace a una nómina que no existe se queda cargando para siempre — A [V]

`PayslipsPage.tsx:163-167` no lee `error` y la línea 237 pinta el esqueleto mientras no haya datos. Con `?nomina=<id>` borrado o ajeno, la API responde 404 y el esqueleto no termina; el botón de volver está dentro del componente que nunca llega a montarse.

**Cambio:** estado vacío «No encontramos esta nómina» con botón de volver, y limpiar el parámetro.

### 1.5. El límite de peticiones de `/api/auth` choca con el propio frontend — A [V en código; el efecto depende de cuántas instancias atiendan]

`backend/src/index.ts` aplica `authLimiter` (20 peticiones cada 15 min por IP) a todo `/api/auth`, incluido `GET /me`. El frontend lo llama **dos veces por carga de página**: `AppShell.tsx:180` y `AuthProvider.tsx:36-41`. Como cada clic en el menú es una recarga completa, unas diez navegaciones en un cuarto de hora bastan para recibir un 429. No es un 401, así que no redirige: el nombre desaparece de Ajustes e Inicio, y tras volver de Google el login puede quedarse parado con sesión válida.

**Cambio:** sacar `GET /auth/me` del `authLimiter` (ese límite estaba pensado para intentos de login, que ya no existen: los hace Supabase) y que `AppShell` use la misma consulta `["me"]` que `AuthProvider`.

### 1.6. Cada clic en el menú recarga la aplicación entera — A [V]

`layouts/Layout.astro` no usa `<ClientRouter />` y no hay `prefetch` en `astro.config.mjs`. Cada navegación vuelve a ejecutar todo el JavaScript, repite los esqueletos y relanza las mismas peticiones (`getSession`, `/auth/me` ×2, alertas, preferencias y las de la página). La caché de 5 minutos de perfiles, categorías y cuentas no sirve entre páginas porque vive en memoria.

Es la causa de fondo de varios síntomas de este fichero: filtros que se pierden, barra lateral que parpadea, peticiones duplicadas, límite de peticiones.

**Cambio, de menor a mayor coste:**
1. `prefetch: { prefetchAll: true }` en `astro.config.mjs`.
2. `<ClientRouter />` con `transition:persist` en `AppShell` (el shell deja de remontarse).
3. Persistir en `sessionStorage` los catálogos no sensibles.

## 2. Flujo de subida (`UploadPage.tsx`)

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 2.1 | M | El aviso de duplicado es un mensaje efímero; la fila no lo refleja ni ofrece acción | `:178-182` | Distintivo «Posible duplicado» en la fila, con «Ver la existente» y «Eliminar esta» |
| 2.2 | M | Perfil y tipo se pueden cambiar durante la subida; el texto muestra el nuevo pero la tanda sigue con el antiguo, y «Reintentar» usa el actual | `:267, 274, 350` | Deshabilitar ambos mientras sube y guardar perfil y tipo en cada elemento de la cola |
| 2.3 | M | Sin aviso al salir; un clic en el menú recarga y corta la cola | sin `beforeunload` | Aviso al salir; opcionalmente 2-3 subidas en paralelo |
| 2.4 | M | Crear un perfil obliga a ir a otra página y volver a mano | `:236-249`, `PayslipsPage.tsx:294-300` | Diálogo de perfil en línea, o perfil por defecto con el nombre de Google en el primer acceso |
| 2.5 | B | La barra de progreso es un pulso indeterminado, sin progreso global de la tanda | `:81-85` | «3 de 12» y barra real |
| 2.6 | B | No se puede corregir el periodo antes de guardar ni se detecta que la empresa difiere de la habitual del perfil | — | Paso de revisión opcional tras la extracción |
| 2.7 | B | Tras subir no hay un «Revisar las N pendientes» que encadene los detalles | — | Botón que abra la primera en revisión y permita pasar a la siguiente |
| 2.8 | B | PDF escaneado: solo una línea de texto explica que no se admite | `:366` | Detectar «sin texto extraíble» y decirlo en la fila con una explicación clara |

## 3. Lista y detalle de nóminas

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 3.1 | M | El botón Atrás no vuelve del detalle a la lista: sale de la página | `lib/url-params.ts:15` usa `replaceState` | `pushState` al abrir y escuchar `popstate` |
| 3.2 | M | Filtros, orden y página no están en la URL; se pierden al recargar o volver | `PayslipsPage.tsx:112-119`; igual en `DashboardPage.tsx:181-189` y `AnalyticsPage.tsx:97-100` | Generalizar `url-params.ts` y sincronizarlos |
| 3.3 | M | La búsqueda lanza una petición por tecla | `PayslipsPage.tsx:420, 134` | Retardo de 250 ms, como en `CommandMenu` |
| 3.4 | M | El filtro de mes se hace en el cliente sobre 100 filas; con más, el resultado es parcial | `:40-42, 220-226` | Añadir `month` al esquema de consulta del backend |
| 3.5 | M | El estado de la nómina no se ve en móvil | `PayslipDetail.tsx:584-589` lo pone en `description`, que `PageHeader.tsx:34` oculta en pantallas pequeñas | Moverlo a un hueco visible |
| 3.6 | M | Guardar y Cancelar solo están arriba; con muchos conceptos hay que subir | `:591-598` | Barra fija inferior mientras se edita |
| 3.7 | M | Abrir una nómina no lleva el scroll arriba en escritorio | `PayslipsPage.tsx:172-173` hace scroll sobre `main` y `window`; el contenedor real es el `div` de `AppShell.tsx:581` | Hacer scroll sobre ese contenedor |
| 3.8 | B | Notas: se borran sin confirmar, el botón solo aparece al pasar el ratón (invisible en táctil) y no se pueden editar | `:287-288` | Botón siempre visible en táctil, «Deshacer», edición |
| 3.9 | B | Quitar el vínculo con el ingreso no pide confirmación | `:419` | «Deshacer» |
| 3.10 | B | Los conceptos de categoría «otros» no se muestran, pero se reenvían al guardar; no se puede cambiar la categoría de un concepto ni si es porcentaje | `:535-536, 509-511` | Tercera sección y selector de categoría |
| 3.11 | B | Sin selección múltiple (eliminar, reprocesar o cambiar tipo en bloque) ni acciones por fila | — | Casillas y barra de acciones, como ya existe en Transacciones |
| 3.12 | B | En móvil se ocultan las tarjetas «Pagas extra» y «Para revisar» | `PayslipsPage.tsx:368, 375` | Fila deslizable o resumen compacto |
| 3.13 | B | Sin navegación anterior/siguiente entre nóminas | — | Flechas en el detalle |

## 4. Panel y analítica de nóminas

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 4.1 | M | El rango por defecto es una fecha fija, `"2021-11"` | `DashboardPage.tsx:35, 184` | Empezar sin rango o recordarlo como preferencia. Es una fecha personal metida en el código |
| 4.2 | M | La selección de varios perfiles no se recuerda (el resto de pantallas sí recuerdan el perfil) | `DashboardPage.tsx:181` | `?perfiles=1,2` y preferencia |
| 4.3 | B | El tooltip del gráfico de IRPF decide el formato por el valor (`v < 100` → porcentaje): un IRPF de 85 € sale como «85,0 %» | `:632` | Decidir por serie |
| 4.4 | B | «Retención neta» nombra lo que te llega del bruto, lo contrario del uso habitual | `:639-652` | «Te llega del bruto», como ya dice la tarjeta |
| 4.5 | M | El IRPF se detecta con `name.includes("irpf")` en tres sitios; falla con «I.R.P.F.» o «Retención a cuenta» | `PayslipDetail.tsx:137, 540`; `DashboardPage.tsx:594` | Clasificar el concepto en el backend al extraerlo (ver `06`) |
| 4.6 | M | Dos sistemas de avisos paralelos con cuatro nombres (Avisos, Anomalías, Recordatorio, Alertas): los de Analítica se calculan al vuelo, los de Alertas son reglas | `AnalyticsPage.tsx:228-231` | Unificar el vocabulario y enlazar «Crear regla para esto» |

## 5. Alertas, perfiles y ajustes

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 5.1 | M | La campana y la página de alertas no se sincronizan: marcar como leída en una no actualiza la otra | `AppShell.tsx:313-345` usa estado y peticiones propias | Pasar la campana a la misma consulta |
| 5.2 | M | Interruptores, «marcar leída» y etiquetas no reaccionan hasta que vuelve el servidor | `AlertsPage.tsx:607-610, 524-534`; `PayslipDetail.tsx:175-184` | Actualización optimista con vuelta atrás si falla |
| 5.3 | M | Un usuario nuevo no tiene ninguna regla, aunque la portada promete «te avisa si algo cambia» | No hay siembra en el alta [S] | Crear dos o tres reglas por defecto al registrarse |
| 5.4 | B | El historial no se pagina ni se filtra, no enlaza con la nómina afectada y no se puede borrar | `AlertsPage.tsx:651` | Enlace, filtro por tipo, «borrar leídas» |
| 5.5 | B | El concepto de una regla se escribe a mano | `AlertsPage.tsx:378-387` | Elegirlo de la lista de conceptos existentes |
| 5.6 | B | «Alertas» solo está en el espacio Nóminas aunque incluye reglas de finanzas; al llegar desde Presupuesto la barra lateral cambia de espacio | `app/navigation.ts:85` | Entrada común a ambos espacios |
| 5.7 | B | Borrar un perfil dice «todas sus nóminas» sin decir cuántas, aunque el dato ya está cargado | `ProfilesPage.tsx:320` | «Se eliminarán 37 nóminas» |
| 5.8 | B | Los diálogos de confirmación se cierran antes de saber si el borrado funcionó | `PayslipsPage.tsx:265`, `ProfilesPage.tsx:323`, `AlertsPage.tsx:697` | Estado «Eliminando…» y cerrar al terminar |
| 5.9 | B | Exportar existe en tres sitios con tres interfaces | `PayslipsPage.tsx:317-335`, `AnalyticsPage.tsx:253-274`, `SettingsPage.tsx:293-313` | Un único menú de exportación compartido |

## 6. Navegación y buscador

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 6.1 | M | ⌘K muestra «Sin resultados» mientras aún está buscando | `app/CommandMenu.tsx:226` | Fila «Buscando…» |
| 6.2 | B | El buscador no menciona nóminas aunque las busca, las lista las últimas incluso dentro de Nóminas, y muestra fechas en ISO | `:215, 105, 100` | Ordenar según el espacio activo y formatear |
| 6.3 | B | La barra lateral parpadea al cargar para quien la tiene plegada; la preferencia caduca a los 7 días | `AppShell.tsx:489, 497-499`; `ui/sidebar.tsx:29` | Script en línea que fije el estado antes de pintar; caducidad de un año |
| 6.4 | B | Fuera de un espacio (Inicio, Ajustes) se asume Nóminas: quien solo usa finanzas ve «Subir nómina» como acción principal | `app/navigation.ts:116` | Recordar el último espacio usado |
| 6.5 | B | La campana muestra ocho avisos sin indicar que hay más | `AppShell.tsx:375` | «Ver los N restantes» |
| 6.6 | M | El atajo `N` abre «Nueva transacción» en toda la app, también en Nóminas, y no se puede desactivar | `AppShell.tsx:508-515` | Limitarlo a Finanzas o permitir desactivarlo |

## 7. Sesión y manejo de errores

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 7.1 | A | Sin sesión, `/app/*` muestra el shell y los esqueletos hasta el primer 401; con varias peticiones en vuelo, cada 401 lanza su propio cierre de sesión | `AuthProvider.tsx:17-29`, `lib/api.ts:39-42` | Redirigir en cuanto `getSession()` dé `null`; un único cierre de sesión compartido |
| 7.2 | M | Errores de Google sin tratar: el botón se queda en «Conectando…» y al volver con `?error=` no se muestra nada | `AuthProvider.tsx:45-49`, `LoginPage.tsx:19-22` | Comprobar el `error` devuelto, leer los parámetros y ofrecer «Reintentar» |
| 7.3 | M | Tras iniciar sesión siempre se va a `/app`; se pierde la página que se quería abrir | `api.ts:41, 230`; `LoginPage.tsx:12` | Parámetro `next`, validando que empiece por `/app/` y no por `//` |
| 7.4 | M | Mensajes crudos: `HTTP 500`, `[object Object]` cuando el backend devuelve un objeto, «Failed to fetch» sin red, «Export failed» en inglés | `lib/api.ts:43, 368` | Clase `ApiError` con `status` y mensaje siempre en español |
| 7.5 | M | Las peticiones no se cancelan ni tienen tiempo límite, y se reintentan también los errores 4xx | `api.ts:18-46`, `query-client.ts:13` | Pasar `signal`, reintentar solo 5xx, mensaje propio para 429 |
| 7.6 | M | Las descargas no tratan el 401 y revocan la URL justo tras el clic, lo que puede cancelar la descarga en Safari | `api.ts:80-95, 359-377` | Usar el `downloadBlob` de `lib/export-utils.ts`, que ya lo hace bien |
| 7.7 | B | `ErrorBoundary` solo escribe en consola y no envuelve el shell | `ErrorBoundary.tsx:23-25`, `Layout.astro:48` | Enviar a un servicio de errores y cubrir `AppShell` |
| 7.8 | B | La política de cookies no menciona `sueldia:lastProfileId` ni `sueldia:pref:*`, y no se borran al cerrar sesión | `pages/cookies.astro:27-37`, `hooks/use-selected-profile.ts:4`, `hooks/use-preference.ts:13` | Completar la política y limpiar al salir |

**Sin hallazgos, comprobado:** no hay `dangerouslySetInnerHTML`; el service worker solo intercepta navegaciones y solo guarda `offline.html` (no almacena respuestas de `/api` ni páginas con datos); el avatar se carga sin enviar referente.

## 8. Accesibilidad

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 8.1 | M | Grupos de opciones con `role="radio"` pero sin teclado de radio (las flechas no hacen nada) | `app/Segmented.tsx:24-47`, `AppShell.tsx:268-286`, `ProfilesPage.tsx:98-118`, `SettingsPage.tsx:94-126, 137-169` | Foco itinerante con flechas, o `aria-pressed` sin rol de radio |
| 8.2 | M | Gráficos sin nombre accesible ni alternativa en tabla; el interanual distingue series solo por color | `DashboardPage.tsx`, `AnalyticsPage.tsx:384-385` | `role="img"` con resumen, `accessibilityLayer` de Recharts, «Ver como tabla» |
| 8.3 | M | El contador de la campana es invisible para lectores de pantalla | `AppShell.tsx:350-359` | `aria-label="Alertas, N sin leer"` |
| 8.4 | M | Etiqueta «Mes» sin asociar a su selector | `PayslipDetail.tsx:642-644` | `htmlFor` e `id` |
| 8.5 | M | El color del perfil se usa sin adaptar al tema; el azul oscuro casi desaparece en modo oscuro. Iniciales blancas sobre ámbar o cian rondan 2:1 [S] | `ui/ProfileSelector.tsx:52`, `ProfilesPage.tsx:28-32` | `adaptiveColor` y color de texto según luminancia |
| 8.6 | M | Dianas táctiles de 20-28 px: quitar etiqueta, borrar nota, marcar leída, paginación, selector segmentado | `PayslipDetail.tsx:244, 288`; `AppShell.tsx:384`; `PayslipsPage.tsx:400-406`; `Segmented.tsx:39` | Mínimo 40-44 px en móvil |
| 8.7 | B | La fila de la tabla hace de botón (`<tr tabIndex>`), y su etiqueta sustituye el contenido de las celdas | `PayslipsPage.tsx:486-492` | Enlace real en la primera celda (arregla también 3.1) |
| 8.8 | B | Cambios sin anunciar: cola de subida sin `aria-live`, esqueletos sin `aria-busy`, «no leída» solo con punto y negrita | `UploadPage.tsx:343-357`, `app/skeletons.tsx`, `AlertsPage.tsx:655-657` | Regiones vivas y texto oculto |
| 8.9 | B | Sin enlace «Saltar al contenido»; `EmptyState` usa `<h3>` justo tras el `<h1>` | `Layout.astro`, `ui/EmptyState.tsx:32` | Añadir el enlace; `<h2>` |
| 8.10 | B | Etiquetas poco útiles: «Color #f59e0b»; el buscador dice «Ctrl+K» y pinta «⌘K» en todas las plataformas | `ProfilesPage.tsx:107`, `AppShell.tsx:445-449` | Nombres de color; detectar plataforma |
| 8.11 | B | Contraste [S]: barras ámbar sobre blanco por debajo de 3:1; enlaces verdes pequeños cerca de 4,3:1; mucho texto de 10-11 px | `DashboardPage.tsx:602`, `AppShell.tsx:392` | Medir con una herramienta y subir tamaño mínimo a 12 px |

**Lo que ya está bien:** `prefers-reduced-motion` respetado en la app y en el sitio público; menú móvil público con `inert` y Escape; `aria-sort` en cabeceras ordenables; estados con icono y texto, no solo color; bruto y neto distinguidos por trazo además de color.

## 9. Rendimiento del frontend

Tamaños medidos sobre `frontend/dist` (build de octubre, sin comprimir; orientativos).

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 9.1 | M | Se carga `supabase-js` completo (348 kB con React Query) para usar solo autenticación | el chunk contiene `realtime`, `storage/v1`, `functions/v1` | `@supabase/auth-js` solo [S: ahorro estimado 80-120 kB] |
| 9.2 | M | `AppShell` importa el diálogo de nueva transacción de forma estática en todas las páginas | `AppShell.tsx:52` | `React.lazy` |
| 9.3 | M | Recharts (419 kB) se carga al entrar en Inicio, Panel y Analítica | — | `React.lazy` para los gráficos bajo el pliegue; en Inicio bastaría `Sparkline`, que es SVG puro |
| 9.4 | M | 190 kB de CSS de la app se cargan también en la portada pública | `dist/index.html` | Separar el CSS público del de la app |
| 9.5 | M | Peticiones de más: «Mis nóminas» pide el panel completo para cuatro cifras y otra petición solo para contar las pendientes; Perfiles lanza una consulta por perfil; el panel con rango pide dos versiones | `PayslipsPage.tsx:152-161`, `ProfilesPage.tsx:219-224`, `DashboardPage.tsx:193-215` | Devolver recuentos por estado y años en `GET /payslips`; `/profiles?withStats=1` |
| 9.6 | B | Cascada: primero perfiles, luego el efecto que elige perfil, luego las consultas | `hooks/use-selected-profile.ts:39-52` | Sembrar el perfil desde la URL o `localStorage` antes de que llegue la lista |
| 9.7 | B | `offline.html` pesa 30 kB por un PNG en base64; fuentes sin `preload`; icono adaptable de 152 kB | `public/` | SVG en línea; `preload`; recomprimir |
| 9.8 | B | Código sin uso: `ui/KpiCard.tsx`, `ui/SectionHeader.tsx`, `formatPercent`, `deleteTag`, y posiblemente las clases `.card`, `.btn-*`, `.input`, `.badge` de `global.css:161-234` [S en las clases] | — | Eliminar tras confirmar con una búsqueda |

## 10. Coherencia y pulido

| # | Pri. | Problema | Evidencia | Cambio |
|---|---|---|---|---|
| 10.1 | M | Títulos de página con dos estilos: unos con remate en serif («Sube tus *nóminas.*»), otros sin él; el panel se titula distinto en error o vacío | `UploadPage.tsx:255`, `DashboardPage.tsx:327, 338, 362`, `AnalyticsPage.tsx:249` | Una sola regla y aplicarla |
| 10.2 | M | Saltos de maquetación entre esqueleto y contenido | `AlertsPage.tsx:552` frente a `:579`; `app/skeletons.tsx:9` | Igualar rejillas y márgenes |
| 10.3 | B | Tres listas de meses distintas; porcentajes con y sin espacio; un parche `.replace(",0 %", " %")`; dos signos menos | `lib/format.ts:1`, `payroll/shared.tsx:5-9`, `CommandMenu.tsx:27`, `DashboardPage.tsx:580, 650` | Centralizar meses, fechas y porcentajes en `lib/format.ts` |
| 10.4 | B | Títulos de pestaña inconsistentes («Nóminas Dashboard», «Mis Nóminas» frente a «Mis nóminas» en el menú); separador ` | ` en la app y ` · ` en el sitio público; «Dashboard» en escritorio y «Resumen» en móvil | `pages/app/*.astro`, `Layout.astro:20`, `app/navigation.ts:80` | Unificar |
| 10.5 | B | Errores de Alertas y Perfiles sin cabecera de página | `AlertsPage.tsx:563-569`, `ProfilesPage.tsx:258-262` | Mantener la cabecera |

## 11. Aplicación instalable (PWA)

- **M [V]** El manifiesto fija fondo y color de tema azul oscuro `#2e3a48`, pero la app pinta `#faf9f6` o `#0f141a`: la pantalla de arranque es de un color y luego salta a otro (`public/manifest.webmanifest:12-13`, `Layout.astro:43`). `offline.html` usa un tercer tono en oscuro.
- **B** Sin `screenshots`, sin icono adaptable de 192 px, sin invitación propia a instalar.
- **B** El acceso directo «Analítica» lleva a finanzas y no hay ninguno para «Mis nóminas» (`manifest.webmanifest:36`).
- **B** La página sin conexión solo ofrece «Reintentar»; podría recargar sola al recuperar la conexión.
- **B** No hay aviso de «nueva versión disponible».

## 12. Sitio público y posicionamiento

- **M [V]** La imagen para redes es el logo cuadrado de 7 kB. Falta una de 1200×630 con texto alternativo (`MarketingLayout.astro:15, 83-87`).
- **M** `sitemap.xml` es manual con fecha fija; `@astrojs/sitemap` lo generaría solo.
- **M** El dominio es `sueldia.vercel.app` (`astro.config.mjs:10`). Un dominio propio afecta a canónicas, sitemap y confianza.
- **B** `robots.txt` bloquea `/login`, que ya lleva `noindex`; con el bloqueo el rastreador no llega a leer esa etiqueta.
- **B** Datos estructurados solo en la portada; la página de precios tiene preguntas frecuentes sin marcar.
- **B** No hay página 404.
- **M — Textos que no cuadran con el producto:**
  - Precios dice «Nóminas y perfiles ilimitados» en el plan gratuito y ofrece «Historial ampliado» en Pro, lo que da a entender que el gratuito sí tiene límite (`pages/precios.astro:14, 29`).
  - Características llama «Dashboard financiero» al panel de nóminas, cuando Finanzas tiene el suyo (`pages/caracteristicas.astro:39`).
  - «Alertas inteligentes» depende de reglas que el usuario tiene que crear a mano (ver 5.3).

## 13. Preparación para otros idiomas

No la hay: todas las cadenas van en línea, `"es-ES"` está fijo en varios ficheros y EUR está fijo en `lib/format.ts:5` aunque las cuentas tienen campo `currency`. No hace falta traducir ahora, pero centralizar formatos (10.3) es el primer paso y resuelve inconsistencias que ya existen.
