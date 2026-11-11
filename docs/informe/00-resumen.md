# Informe de análisis de SueldIA

Fecha: 11 de noviembre de 2026 · Rama `main` (commit `dafd7f5`).

## Cómo se hizo

- Lectura completa del backend (rutas, servicios, middleware, esquema, migraciones, analizadores) y del frontend (páginas, componentes, ganchos, utilidades, PWA y sitio público). La carpeta `old/` quedó fuera.
- Ejecutado: `npm audit --omit=dev`, la batería de tests del backend (149 pruebas, todas pasan) y comprobaciones puntuales en Node.
- **No** se ejecutó la aplicación en un navegador ni se hizo ninguna petición a tu proyecto de Supabase o a producción. Lo que depende de eso está marcado como sospecha **[S]**; el resto está verificado en el código **[V]** con fichero y línea.
- No se ha modificado ningún fichero de código. Lo único nuevo es esta carpeta.

## Ficheros

| Fichero | Contenido |
|---|---|
| `01-seguridad-supabase-rls.md` | La alerta «RLS Disabled in Public»: qué significa, alcance real, migración lista para aplicar, ajustes del proyecto |
| `02-seguridad-aplicacion.md` | Autenticación, autorización, validación, cabeceras, CSV, datos personales |
| `03-backend-y-base-de-datos.md` | Errores de comportamiento, rendimiento, índices, modelo de datos, diseño de la API |
| `04-usabilidad-nominas-y-shell.md` | Subida, lista y detalle de nóminas, panel, alertas, navegación, sesión, accesibilidad, PWA, sitio público |
| `05-usabilidad-finanzas.md` | Transacciones, recurrentes, presupuesto, categorías, cuentas, importación, analítica |
| `06-nuevas-funcionalidades.md` | Ampliaciones, agrupadas por área, con lo que existe hoy y lo que falta |
| `07-hoja-de-ruta.md` | Todo lo anterior ordenado en fases, con dependencias |
| `08-dependencias-despliegue-y-calidad.md` | Vulnerabilidades de dependencias, CI, despliegue, documentación desfasada |

## Lo esencial

### 1. La alerta de Supabase es más grave de lo que parece

No afecta solo a `users`: **ninguna de las 18 tablas tiene RLS**. La aplicación no usa la API de datos de Supabase (todo pasa por Express), pero esa API existe y se usa con la clave anónima, que está en el JavaScript del navegador. Si los permisos por defecto siguen activos, cualquiera puede leer y modificar los datos de todos los usuarios, incluido el texto completo de cada nómina (`payslips.raw_text`: nombre, NIF, IBAN, salario).

La corrección es una migración de unas 40 líneas que no afecta al funcionamiento de la app, más apagar esa API. Está en `01`, con el comando para comprobar en dos minutos si la exposición es real.

### 2. La autorización de la API propia está bien

Revisadas todas las rutas: no hay ninguna que permita a un usuario leer o modificar datos de otro. Lo que falta es una prueba automática que lo garantice en adelante.

### 3. Un usuario puede romper el cron diario de todos

Una fecha como `2025-02-32` en una regla recurrente supera la validación, se guarda, y a partir de ahí el proceso diario falla para todos los usuarios posteriores y las alertas dejan de evaluarse para todo el mundo (`02 §2.1`).

### 4. Hay errores que falsean o pierden datos

- Liquidar un traspaso solo cambia una de sus dos patas: los saldos se descuadran (`03 §1.1`).
- Editar una nómina sin periodo le pone el mes actual; un bruto desconocido se guarda como 0 € (`04 §1.2`).
- La edición de una nómina se pierde si cambias de ventana más de 30 segundos (`04 §1.1`).
- Reprocesar borra las correcciones manuales sin preguntar (`03 §1.3`).
- Borrar una categoría descuadra el presupuesto y no avisa de lo que se pierde (`05 §1.1`).
- En las acciones en lote, el botón por defecto es «Quitar categoría» (`05 §1.4`).

### 5. La fricción de uso tiene una causa de fondo

Cada clic en el menú recarga la aplicación entera. De ahí salen los filtros que se pierden, las peticiones repetidas, el parpadeo y el choque con el límite de peticiones (`04 §1.6`). Junto con la falta de «Deshacer» y los esqueletos de página completa al cambiar un filtro, es lo que más se nota al usarla.

### 6. No hay red de seguridad

Sin integración continua (los 149 tests no se ejecutan solos), sin pruebas de frontend ni de rutas, sin monitorización de errores, 29 avisos de dependencias (3 críticos), y la documentación describe la versión anterior de la app (`08`).

### 7. Dónde está el mayor valor nuevo

- **Conciliación** e **importación genérica de extractos bancarios**: sin ellas, el módulo de finanzas depende de teclear o de venir de YNAB.
- **Clasificación semántica de los conceptos** de la nómina: desbloquea comparaciones, la vista para la Renta y el análisis de IRPF.
- **Cruzar nóminas y finanzas** (ahorro real, vínculo en ambos sentidos): es lo que diferencia al producto y hoy casi no se aprovecha.

## Recuento

| Fichero | Hallazgos |
|---|---|
| Seguridad (`01`, `02`) | 1 crítico, 2 altos, 5 medios, 10 bajos |
| Backend y datos (`03`) | 3 altos, 11 medios, 11 bajos en comportamiento; 10 de rendimiento; 11 índices; 10 de modelo; 7 de API |
| Nóminas y navegación (`04`) | 6 destacados y doce tablas de puntos menores |
| Finanzas (`05`) | 10 destacados y diez tablas de puntos menores |
| Funcionalidad nueva (`06`) | 52 propuestas |
| Dependencias y despliegue (`08`) | 29 avisos de `npm audit`, 10 de despliegue, 8 de documentación |

## Por dónde empezar

La Fase 0 de `07-hoja-de-ruta.md`: siete tareas, menos de un día, todas de seguridad. Después, la Fase 1 corrige los errores que pierden datos.
