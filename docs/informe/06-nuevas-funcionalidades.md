# 06 · Nuevas funcionalidades y ampliaciones

Ideas apoyadas en lo que el código ya tiene. Cada una indica **qué existe hoy**, **qué falta** y una estimación gruesa de esfuerzo: **S** (horas), **M** (días), **L** (semanas). Los errores y retoques de lo existente están en `03`, `04` y `05`; aquí solo hay cosas nuevas.

El orden dentro de cada bloque es el recomendado.

## A. Nóminas

### A1. Corrección manual completa — M
- **Hoy:** se editan nombre e importe de conceptos, empresa, periodo, bruto y neto.
- **Falta:**
  - Cambiar la categoría de un concepto (devengo, deducción, otros) y si es porcentaje.
  - Validación en vivo mientras se edita: suma de devengos = bruto; bruto − deducciones = neto. Hoy los avisos se ocultan justo al editar.
  - Ver el texto extraído **al lado** del formulario, no en un desplegable al final.
  - «Marcar como revisada» sin tener que guardar cambios.
  - Mover una nómina a otro perfil.
  - Marca `manually_edited` para proteger las correcciones (ver `03`, 1.3).

### A2. Ver el PDF mientras se revisa, sin almacenarlo — M
- **Hoy:** el PDF se descarta tras extraer el texto (decisión de diseño que conviene mantener).
- **Idea:** durante la subida, el navegador todavía tiene el fichero. Mostrarlo con `URL.createObjectURL` junto al resultado de la extracción permite revisar en el momento, sin que el PDF salga del dispositivo ni se guarde en ningún sitio.

### A3. Clasificación semántica de conceptos — M
- **Hoy:** el IRPF se detecta con `name.includes("irpf")` en tres sitios del frontend; la Seguridad Social se calcula como «lo que sobra».
- **Falta:** que el analizador asigne a cada concepto un tipo (`irpf`, `ss_contingencias_comunes`, `ss_desempleo`, `ss_formacion`, `mei`, `salario_base`, `complemento`, `paga_extra`, `especie`, `dieta`, `otros`) y lo guarde en `payslip_concepts`.
- **Desbloquea:** desglose real de cotizaciones, bases de cotización, tipo efectivo de cada cosa, comparaciones fiables entre nóminas y casi todo lo de A4-A6.

### A4. Comparar nóminas — M
- **Hoy:** solo hay agregados (interanual, evolución por concepto).
- **Falta:** dentro del detalle, comparación concepto a concepto con el mes anterior y con el mismo mes del año pasado: qué ha subido, qué ha bajado, qué concepto es nuevo y cuál ha desaparecido. Y flechas anterior/siguiente.

### A5. Resumen anual y vista para la Renta — M
- **Hoy:** tarjetas por año con totales y proyección.
- **Falta:**
  - Rejilla año × mes que muestre de un vistazo qué nóminas hay y cuáles faltan, por perfil.
  - Vista «datos para la declaración»: retribuciones íntegras, retenciones y cotizaciones del ejercicio, para cotejar con el certificado de retenciones de la empresa.
  - Versión imprimible o en PDF.

### A6. Inteligencia sobre el IRPF — M/L
- Aviso cuando cambia el tipo de retención de un mes a otro (hoy se calcula al vuelo en Analítica pero no genera alerta).
- Estimación de la regularización de fin de año: con el bruto acumulado y el tipo aplicado, si la retención va corta o larga.
- Simulador sencillo: «¿cuánto me queda neto si me suben X?». Requiere las tablas de retención del ejercicio; conviene dejar muy claro que es una estimación.
- Coste total para la empresa, si la nómina trae la aportación empresarial.

### A7. Detección real de duplicados — S
- **Hoy:** aviso efímero si coinciden perfil y periodo.
- **Falta:** resumen criptográfico del texto extraído; si coincide, ofrecer «ya la tienes» o «sustituir». Flujo de «nómina corregida» que reemplace a la anterior sin duplicar totales.

### A8. Búsqueda en el contenido — S
- **Hoy:** `raw_text` se guarda, pero la búsqueda solo mira nombre de fichero y empresa.
- **Falta:** buscar en conceptos, notas y texto. Con Postgres basta un índice de texto completo.

### A9. Etiquetas y notas útiles — S
- **Hoy:** se crean y se asignan, pero no sirven para nada más.
- **Falta:** filtrar la lista por etiqueta y verlas en ella; renombrar y eliminar etiquetas (la función de borrado existe sin interfaz); editar notas.

### A10. Reprocesado masivo con vista previa — M
- **Hoy:** el backend tiene `POST /payslips/reparse`; el frontend no lo usa.
- **Falta:** botón «Reprocesar todas» que primero muestre **qué cambiaría** (nómina por nómina, diferencias en bruto, neto y número de conceptos) y respete las editadas a mano.

### A11. Perfil con datos que alimenten los cálculos — M
- **Hoy:** un perfil es nombre y color.
- **Falta:** número de pagas (12 o 14), empresa actual, comunidad autónoma, jornada. Con eso, el aviso de SMI deja de dar falsos positivos, las proyecciones anuales son correctas y el historial de empresas se puede agrupar.

### A12. Vista de hogar — M
- **Hoy:** el panel admite varios perfiles; la analítica solo uno.
- **Falta:** comparativa entre perfiles e ingresos totales del hogar.

### A13. Acciones en lote sobre nóminas — S
Selección múltiple para eliminar, reprocesar, cambiar tipo o etiquetar. El patrón ya existe en Transacciones.

## B. Analizador de nóminas

### B1. Más formatos, con una arquitectura que lo permita — L
- **Hoy:** dos formatos (`type1` empresa privada, `type2` organismo público) en un fichero de 1.047 líneas de expresiones regulares.
- **Propuesta:** una interfaz por formato (`detect(texto) → confianza`, `parse(texto) → resultado`) y un registro de formatos. Cada formato nuevo entra con su fichero y sus nóminas de prueba anonimizadas.
- Formatos candidatos por frecuencia en España: los de los programas de nóminas más extendidos (A3, Sage, Meta4, SAP, Factorial, Personio, Holded).

### B2. Analizador asistido por modelo de lenguaje como respaldo — M
- **Cuándo:** solo si el analizador de reglas deja la nómina en `review` (ningún concepto) o los totales no cuadran.
- **Cómo:** enviar el texto extraído (no el PDF) a un modelo con una salida estructurada validada con Zod, y marcar el resultado como «extraído automáticamente, revísalo».
- **A tener en cuenta:** implica enviar datos personales a un tercero. Debe ser **opcional**, explicarse en la privacidad, y conviene anonimizar antes lo evidente (NIF, IBAN, número de afiliación). Es una decisión de producto, no solo técnica.

### B3. PDF escaneados — L
- **Hoy:** no se admiten (sin OCR, por diseño).
- **Opciones:** OCR en el navegador con WebAssembly (el PDF no sale del dispositivo, coherente con la promesa de privacidad) o dejarlo fuera y explicarlo bien. Como mínimo, detectar «PDF sin texto» y decirlo claramente en lugar de dejar la nómina en revisión.

### B4. Métricas de calidad del analizador — S
Registrar formato detectado, estado final y tiempo por nómina. Sin esto no se sabe qué formato falla más ni si una mejora ha mejorado algo.

## C. Alertas

### C1. Reglas por defecto al registrarse — S
La portada promete avisos; un usuario nuevo tiene cero reglas. Crear tres al dar de alta: bajada de neto superior al 5 %, nómina ausente y cambio de retención.

### C2. Convertir las anomalías en alertas — S
`detectAnomalies` ya calcula cambios de IRPF y salarios atípicos, pero solo se ven al abrir Analítica. Añadir los tipos `irpf_change`, `salary_anomaly` y «concepto nuevo o desaparecido», y unificar vocabulario (hoy hay cuatro nombres).

### C3. Nómina frente a banco — S
El vínculo nómina ↔ ingreso existe. Falta: avisar si el neto y el abono difieren; avisar de nómina subida sin ingreso vinculado; y «crear el ingreso desde la nómina» con un clic.

### C4. Entrega fuera de la app — M
Hoy las alertas solo se ven al entrar. El cron diario ya existe: un resumen por correo (semanal o al producirse) o notificaciones push de la PWA. Requiere un proveedor de correo y una preferencia para desactivarlo.

### C5. Más reglas de finanzas — S/M
- Presupuesto al 80 % (hoy solo al superarlo).
- Saldo bajo **previsto** (la previsión ya existe) y no solo actual.
- Subida de precio de una suscripción (la mediana y la tolerancia ya se calculan).
- Cargo duplicado; gasto inusualmente alto en una categoría.

### C6. Probar una regla — S
«¿Qué habría disparado esta regla en los últimos 12 meses?» antes de guardarla. Evita reglas que nunca saltan o que saltan siempre.

## D. Finanzas

### D1. Conciliación de cuentas — M
- **Hoy:** no existe. Hay estado liquidado/pendiente y tres saldos por cuenta.
- **Flujo:** «Conciliar» → introducir el saldo que dice el banco → ver la diferencia con el liquidado → marcar lo que falta → crear un ajuste si hace falta → bloquear lo conciliado.
- Es la pieza que falta para fiarse de los saldos; todo lo demás (presupuesto, previsión) depende de que sean correctos.

### D2. Importación genérica de extractos bancarios — L
- **Hoy:** solo el formato de YNAB, con números y fechas en formato europeo.
- **Falta:** asistente con detección de separador y codificación, mapeo de columnas (fecha, concepto, importe o cargo/abono, saldo), elección de cuenta destino, vista previa por fila, aplicación de las reglas de categorización al vuelo, y plantilla guardada por banco. Formatos: CSV y XLS de los bancos españoles, Norma 43 y OFX.
- Para la mayoría de usuarios potenciales esta es **la** vía de entrada de datos; teclear cada movimiento no escala.

### D3. Importaciones con vuelta atrás — M
Identificador de lote, filtro «importado el…» y «Deshacer importación». Vista previa real con el estado de cada fila (ver `05`, 1.9).

### D4. Sincronización bancaria (PSD2) — L
Conexión mediante un agregador europeo (GoCardless Bank Account Data, Tink, Salt Edge). Elimina la importación manual, pero añade un proveedor, renovaciones de consentimiento cada 90-180 días y más responsabilidad sobre datos sensibles. Solo tiene sentido después de D1-D3 y con RLS, cabeceras y pruebas de autorización resueltas.

### D5. Reglas de categorización más ricas — M
- **Hoy:** «el beneficiario contiene X → categoría».
- **Falta:** condiciones por nota, importe, cuenta y tipo; acciones como renombrar el beneficiario o marcar; prioridad; edición; contador de coincidencias; «crear regla a partir de este movimiento»; aplicarlas también al importar y a ingresos.

### D6. Gestión de beneficiarios — M
Son texto libre: «MERCADONA 1234», «Mercadona» y «mercadona s.a.» fragmentan reglas y rankings. Página de beneficiarios con renombrar, fusionar, categoría por defecto y gasto acumulado.

### D7. Presupuesto — M
- Mover dinero libremente entre categorías.
- Incluir saldos iniciales en «Para presupuestar» y explicar su origen.
- Fila «Sin categoría».
- Copiar o vaciar un mes; plegar grupos; notas por categoría.
- Borrar una categoría con reasignación.
- Vista anual: asignado frente a gastado, mes a mes.

### D8. Patrimonio neto, deudas e inversiones — M
- **Hoy:** evolución del saldo e indicadores de liquidez, inversión y tarjetas.
- **Falta:** tipos de cuenta préstamo e hipoteca (con cuadro de amortización: cuota, intereses, capital pendiente); «actualizar valor» para inversiones sin tener que crear un movimiento; vista de activos frente a pasivos a lo largo del tiempo.

### D9. Objetivos de ahorro — M
Los objetivos por categoría existen. Falta la versión que la gente entiende: «Vacaciones: 2.000 € para julio», con progreso visible, aportación mensual sugerida y cuenta asociada.

### D10. Recurrentes — S/M
Traspasos recurrentes; saltar o posponer una ocurrencia; «desde hoy» al crear (para no rellenar el pasado); vista de calendario; detección de suscripciones anuales y semanales; indicador de coste mensual total en suscripciones.

### D11. Informe anual — M
`month-report.service.ts` es puro y está probado; extenderlo a año completo y a «este mes frente al mismo del año pasado». Con versión imprimible.

### D12. Previsión — S/M
Por cuenta; horizonte elegible; lista completa de próximos cargos; escenario «si gasto lo presupuestado».

### D13. Multidivisa: decidir — S o L
Hoy las cuentas tienen moneda pero todo se suma sin convertir. O se retira el campo (S) o se implementa con tipos de cambio (L). Lo peor es el estado actual, que sugiere algo que no existe.

### D14. Marcas de color — S
El campo `flag` existe en la API y ninguna pantalla lo usa. Exponerlo (elegir, filtrar) o retirarlo.

### D15. Presupuesto compartido — L
Hoy cada usuario está aislado. Para parejas: invitar a otra persona, primero en solo lectura. Cambia el modelo de autorización (de «usuario» a «hogar»), así que es un proyecto en sí mismo.

## E. Donde nóminas y finanzas se encuentran

Es lo que distingue a SueldIA de una app de nóminas o de un clon de YNAB, y hoy está casi sin explotar.

### E1. Ahorro real — S
Neto de las nóminas frente a gasto del mes: tasa de ahorro sobre el sueldo, por mes y por año. Los dos datos existen; ningún punto de entrada los une.

### E2. Vínculo nómina ↔ ingreso en los dos sentidos — S
Hoy solo se ve desde la nómina. En Transacciones: distintivo «Nómina» con enlace y «Vincular con nómina…» en el menú de un ingreso. Vinculación automática cuando importe y fecha coinciden sin ambigüedad.

### E3. Del bruto al bolsillo — M
Un diagrama de flujo anual: bruto → IRPF y Seguridad Social → neto → categorías de gasto → ahorro. La app ya tiene un diagrama de este tipo para finanzas; alimentarlo con las nóminas cierra el círculo.

### E4. Inicio que responda a «¿cómo voy?» — M
Hoy Inicio es una colección de tarjetas. Una versión orientada a decisiones: cuánto queda para llegar a fin de mes según la previsión, qué requiere atención (nóminas por revisar, gastos sin categoría, pendientes vencidos, categorías excedidas) y un solo gráfico.

## F. Cuenta, datos y plataforma

### F1. Exportación e importación completas — M
Completar `/export/all` (faltan objetivos, reglas y preferencias) y permitir **restaurar** desde ese fichero. Cubre portabilidad y sirve de copia de seguridad personal, importante porque los PDF no se guardan.

### F2. Exportaciones para personas — S
Excel con formato; CSV con punto y coma y coma decimal (el actual se abre mal en Excel en español); PNG y CSV de los gráficos de nóminas (la utilidad existe y solo la usa finanzas); exportar con los filtros aplicados.

### F3. Primeros pasos de verdad — M
Perfil creado automáticamente con el nombre de Google; datos de ejemplo para explorar sin subir nada; lista de progreso que se recuerde; categorías y reglas de alerta por defecto.

### F4. Más formas de entrar — S
Solo Google hoy. Añadir enlace mágico por correo o Apple: hay quien no usa Google para esto. (Coordinar con los ajustes de proveedores de `01`, sección 6.)

### F5. Atajos de teclado — S
Existen `N`, `⌘K` y `Ctrl+Enter`. Añadir `/` para buscar, flechas para moverse por las filas, `E` editar, `C` liquidar, `?` para ver la lista.

### F6. Buscador con sintaxis — M
`⌘K` ya busca movimientos y nóminas. Interpretar «mercadona >50 oct» o «nómina marzo 2025».

### F7. Aplicación instalable completa — M
Aviso de nueva versión, invitación a instalar, lectura sin conexión de los últimos datos (con cuidado: son datos sensibles en el dispositivo), y «compartir con SueldIA» para enviar un PDF desde el correo del móvil directamente a la subida (Web Share Target).

### F8. Dominio propio — S
`sueldia.vercel.app` hoy. Afecta a confianza, posicionamiento y a la configuración de redirecciones de autenticación.

### F9. Registro de actividad — M
«Qué ha cambiado y cuándo»: base para «Deshacer», para depurar y para que el usuario confíe en importaciones y acciones en lote.

### F10. Plan Pro — decisión de producto
La página de precios anuncia un plan Pro «próximamente». Candidatos naturales de pago, por coste real o valor claro: sincronización bancaria (D4), analizador asistido (B2), alertas por correo (C4), presupuesto compartido (D15), exportación para la Renta (A5).
