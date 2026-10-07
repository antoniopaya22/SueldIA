# Frontend — Instrucciones para Agentes

## Stack

Astro 5 + React 19 + TanStack React Query 5 + Tailwind CSS 4 + shadcn/ui (Base UI) + Lucide React + Recharts. Salida estática, desplegada en Vercel.

## Rutas

- `/`, `/caracteristicas`, `/precios` — páginas de marketing, públicas, con `MarketingLayout.astro` (sin `Providers`, sin llamadas a la API).
- `/login` — login/registro, con `AuthProvider` pero sin el `Layout` de la app.
- `/app/*` — la aplicación real (dashboard, nóminas, finanzas), con `Layout.astro` (sidebar/nav) detrás del login. Cualquier página nueva de la app va aquí, nunca en la raíz.

## Patrón de Páginas (dentro de `/app`)

### 1. Página Astro (`src/pages/app/nombre.astro`)
```astro
---
import Layout from '../../layouts/Layout.astro';
import NombreComponent from '../../components/NombrePage.tsx';
---
<Layout title="Título de Página">
  <NombreComponent client:load />
</Layout>
```

### 2. Componente React de Página (`src/components/NombrePage.tsx`)
```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDatos, crearDato } from '../lib/api';
import { Providers } from './Providers';
import { PageHeader, StatGrid, SectionCard, PageHeaderSkeleton, ChartCardSkeleton } from './app';
import { EmptyState } from './ui/EmptyState';

function NombreView() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['datos'],
    queryFn: getDatos,
  });

  if (isLoading) return <><PageHeaderSkeleton /><ChartCardSkeleton /></>;
  if (error) return <EmptyState icon={AlertTriangle} title="No se pudieron cargar los datos" description="Vuelve a intentarlo en unos segundos." />;

  return (
    <div>
      <PageHeader title="Título" description="Qué ves en esta página." actions={/* botones */ null} />
      <StatGrid>{/* StatCard… */}</StatGrid>
      <SectionCard className="mt-6" title="Bloque">{/* contenido */}</SectionCard>
    </div>
  );
}

export default function NombrePage() {
  return (
    <Providers>
      <NombreView />
    </Providers>
  );
}
```

Las páginas de marketing (`.astro` en la raíz de `src/pages/`) no usan `Providers` ni `client:load` — son estáticas, sin datos ni auth.

## Providers

```tsx
// src/components/Providers.tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    {children}
    <Toaster position="bottom-right" />
  </AuthProvider>
</QueryClientProvider>
```

Toasts con `sonner` (`import { toast } from "sonner"`, luego `toast.success(...)`/`toast.error(...)`) — no hay un `ToastProvider`/`useToast` propio.

Configuración de QueryClient: `staleTime: 30_000`, `retry: 1`

## API Client

Centralizado en `src/lib/api.ts`. Patrón:

```typescript
async function request<T>(endpoint: string, options?: RequestInit): Promise<T>
export async function getPayslips(params): Promise<PayslipsResponse>
export async function uploadPayslips(profileId, files): Promise<Payslip[]>
```

Reglas:
- **Nunca** hacer `fetch()` directo en componentes — siempre a través de `api.ts`
- El token es el `access_token` de la sesión de Supabase (`getAuthToken()`, async) — se inyecta automáticamente en headers; no hay nada en `localStorage` propio
- Error 401 → `clearAuth()` (signOut de Supabase) + `window.location.href = "/login"`
- Formato: `lib/format.ts` (`formatCurrency` agrupa siempre miles, `formatPct` → "77,7 %", `formatCompact` → "2,1k €", `formatMonthLabel` → "Sep 26"). No usar `toFixed` para mostrar porcentajes.
- Funciones de upload y export usan `fetch` directo (no JSON body)

## Auth Flow

Login con Google vía **Supabase Auth** (`src/lib/supabase.ts`) — no hay login/registro propio, ni contraseñas.

1. `AuthProvider` comprueba `supabase.auth.getSession()` al montar y se suscribe a `onAuthStateChange` → si hay sesión, llama a `getMe()` (crea la fila en `users` la primera vez) y setea el user.
2. Login → `loginWithGoogle()` llama a `supabase.auth.signInWithOAuth({provider: "google"})`, que redirige a Google y vuelve a `/login`; la sesión se recoge sola vía `onAuthStateChange`.
3. Logout → `supabase.auth.signOut()` → redirect a `/` (la landing, no `/login` — cerrar sesión a propósito no debe llevar de vuelta al formulario de entrar).
4. `api.ts` pide el `access_token` vigente a Supabase en cada petición (`getAuthToken()`, async) — el refresco de sesión lo gestiona el propio cliente de Supabase, no hay que hacer nada manual.
5. Cualquier 401 en API → `signOut()` + redirect `/login` (cubre toda página bajo `/app`, no hace falta un guard por página).

## Estilos y Design Tokens

Tailwind v4 (config vía `@theme`/`@config` en `src/styles/global.css`, no solo `tailwind.config.mjs`) + componentes de shadcn/ui (`@/components/ui/*`, base **Base UI**, no Radix).

- **Tokens semánticos de shadcn** (se adaptan solos a dark mode): `bg-background`, `text-foreground`, `bg-card`/`text-card-foreground`, `bg-primary`/`text-primary-foreground`, `bg-muted`/`text-muted-foreground`, `bg-destructive`/`text-destructive`, `border-border`, `border-input`, `bg-accent`/`text-accent-foreground`.
- **Marca (logo)**: verde `primary-*` (500 = `#42af78`, 600 = `#2a8558` para texto blanco encima; en oscuro `--primary` = `#40d880`) + navy `brand-navy` (`#2e3a48`). Son los **únicos acentos**: nada de azul fijo. `success`/`danger`/ámbar solo para semántica de datos (ingreso/gasto/impuesto).
- **Lienzo de la app**: `Layout.astro` pone `class="app-root"` en el body; en `global.css` esa clase redefine `--background` (panel papel `#faf9f6`), `--card` (blanco), `--sidebar` (marco cálido) y sus equivalentes oscuros con matiz navy. La landing no usa `.app-root` y no se ve afectada.
- **Tipografía de la app**: Geist Variable. `font-mono` dentro de `.app-root` se remapea a Geist con cifras tabulares (para importes); en código nuevo usar `tabular-nums` directamente. Acento editorial opcional: clase `font-serif-accent` (Instrument Serif itálica), solo en títulos y con moderación.
- Componentes reutilizables en `@/components/ui/`: `Button`, `Card`, `Input`, `Label`, `Badge`, `Select`, `Table`, `Tabs`, `DropdownMenu`, `Dialog`, `AlertDialog`, `Avatar`, `Separator`, `Tooltip`, `Popover`, `Checkbox`, `Switch`, `Textarea`, `Sonner` (toasts). Base UI usa la prop `render` para polimorfismo (no `asChild` de Radix); para un link con pinta de botón, usar `buttonVariants({...})` sobre una `<a>` en vez de envolver `<Button>`.
- Clases de componente heredadas en `global.css` (`.card`, `.btn-primary/secondary/danger/ghost`, `.input`, `.badge`, `.skeleton`) siguen existiendo para las páginas de la app ya construidas — están redefinidas sobre los tokens de shadcn, no reescribir cada página para usar los componentes de `ui/` salvo que se toque esa página de todos modos.
- **Fuentes**: `font-sans` es Geist Variable (`--font-sans` en `global.css`, texto general y marca/shadcn); dentro de `.app-root` `font-mono` también se remapea a Geist (cifras tabulares en importes). Fira Sans/Fira Code se cargan desde Google Fonts en `global.css:1` pero no se usan en ningún sitio — pendiente de quitar (ver auditoría de rendimiento).
- **Dark mode**: estrategia `class`. Preferencia en `localStorage.theme` (`light`/`dark`; sin clave = sistema). Única fuente de verdad: hook `useTheme()` (`src/hooks/use-theme.ts`) — `{ preference, resolved, setPreference }`; sincroniza entre islas. El script inline de `Layout.astro`/`login.astro` aplica el tema antes de pintar.

## Layout

- `src/layouts/Layout.astro` — la app (`/app/*`): renderiza `<AppShell client:load currentPath>` con la página como `children`.
- `src/components/AppShell.tsx` — sidebar de shadcn en variante `inset` (colapsable a iconos, cookie `sidebar_state`, sheet en móvil), selector de espacio Finanzas/Nóminas, menú de usuario en el pie (avatar de Google, Ajustes, tema, cerrar sesión), cabecera fija translúcida con breadcrumbs, buscador ⌘K (`app/CommandMenu.tsx`) y acción principal contextual. El contenido va en un contenedor `max-w-7xl` con fade-in (`.app-page`).
- `src/components/app/MobileTabBar.tsx` — en móvil (< `md`) barra de pestañas inferior: las tres `mobileTabs` del espacio (`navigation.ts`), la acción principal en el centro y "Más" (abre el sidebar). Lo que vaya fijo abajo debe sumar `var(--mobile-nav-h)` (0 en escritorio) para no quedar tapado. En móvil la cabecera no lleva botón de menú ni acción principal, `PageHeader` oculta la descripción, `StatGrid` va a dos columnas y `DialogContent` sale como hoja desde abajo (`mobileSheet={false}` para dejarlo centrado).
- `src/components/app/navigation.ts` — **única fuente de verdad** de rutas, iconos, espacios y acción principal de cada espacio. Una página nueva de la app se añade aquí (y aparece sola en sidebar, breadcrumbs y ⌘K).
- `src/layouts/MarketingLayout.astro` — páginas públicas: header con nav a Características/Precios + CTA a `/login`, footer simple.

## Sistema de diseño de la app (`src/components/app/`)

Importar desde `./app` (barrel). Toda página de `/app` debe construirse con estas piezas — ver `HomeDashboardPage.tsx` y `DashboardPage.tsx` como referencia.

- `PageHeader` — `title`, `accent?` (final en serif itálica), `eyebrow?`, `description?`, `actions?` (derecha), `children?` (fila de filtros). Una por página, siempre arriba.
- `StatCard` / `StatGrid` — `label`, `value`, `icon?`, `delta?: { value, trend: "up"|"down"|"flat", tone?, label? }` (subir = positivo salvo `tone` explícito; invertir para gastos/impuestos), `hint?`, `sparkline?: number[]`, `sparklineColor?`, `emphasis?`. `StatGrid` = 1/2/4 columnas. `ui/KpiCard` queda como adaptador de compatibilidad.
- `SectionCard` — contenedor base (card con borde fino): `title?`, `description?`, `icon?`, `action?`, `footer?`, `flush?` (sin padding, para tablas/listas). `CardLink` para "Ver todo".
- `ChartCard` — `SectionCard` con área de gráfico de alto fijo (`height`) y `legend?`. Dentro, `<ResponsiveContainer width="100%" height="100%">`.
- `Segmented` — selector segmentado accesible (tipo de gráfico, periodo, tema).
- `Sparkline` — minigráfico SVG sin Recharts.
- Skeletons: `PageHeaderSkeleton`, `StatCardSkeleton`, `ChartCardSkeleton`, `ListCardSkeleton` (misma geometría que lo real).
- `ui/EmptyState` (`compact?`, `children` para acciones propias), `ui/ChartTooltip` (sigue el tema; `valueFormatter`), `ui/ProfileSelector` (chips), `ui/SectionHeader`.

**Tema de gráficas** (`app/chart-theme.ts`): usar siempre `chartGrid`, `chartAxis`, `chartCursor`/`chartBarCursor`, `chartActiveDot`, `chartColors` (`primary` = verde marca, `secondary` = navy/pizarra, `tax` = ámbar, `income`/`expense`) y `chartPalette` para categorías. Todo va por variables CSS (`--chart-1..5`), así que funciona en claro y oscuro sin JS. Nada de colores hex de marca sueltos ni tooltips con fondo fijo.

Patrón visual: bruto en navy (línea discontinua), neto en verde (área/sólido); datos multi-perfil agregados por mes antes de pintar series temporales.

- **Recharts no ve hijos dentro de `<Fragment>`**: ejes, series o `<Cell>` condicionales van como arrays con `key`, nunca envueltos en `<>...</>` (si no, el gráfico sale vacío sin error).
- **Colores elegidos por el usuario** (perfiles, cuentas, grupos): pasarlos siempre por `lib/color.ts` — `adaptiveColor(hex)` para series/`style` (los muy oscuros pasan a `--chart-2`) o `darkBoost(hex)` como clase; si no, el navy desaparece en modo oscuro.
- Componentes locales por dominio: `components/finance/` (tooltips por serie, rankings, presets de periodo), `components/finance-manage/` (tabla y diálogos de transacciones, swatches, acciones de fila), `components/payroll/` (badges de estado, `ProfileDot`, `PayslipDetail`).

## PWA

La app es instalable: `public/manifest.webmanifest` (nombre, colores, iconos en `public/icons/`, atajos a Nueva transacción / Subir nómina / Analítica), enlazado desde `Layout.astro`, `MarketingLayout.astro` y `login.astro`. `public/sw.js` es un service worker **mínimo**: solo guarda `public/offline.html` y la muestra si una navegación falla sin red. **No cachea nada de `/api` ni de las páginas de la app** (son datos financieros); no añadir caché de datos sin decidirlo explícitamente. Si cambias `offline.html`, sube la versión de `CACHE` en `sw.js`.

## Reglas Críticas

- **No usar default exports** excepto en componentes de página (el export default envuelve con Providers)
- **React Query para todo data fetching** — nunca `useEffect` + `fetch`
- **Invalidar queries** después de mutaciones exitosas: `queryClient.invalidateQueries()`
- **Loading/Error states** obligatorios en toda vista que cargue datos
- **Mensajes en español** — todo texto visible al usuario
- **Responsive**: mobile-first con breakpoints de Tailwind (`sm:`, `md:`, `lg:`)
- **Iconos**: usar `lucide-react` — importar componentes individuales (`import { Upload } from 'lucide-react'`)
- **Enlaces internos de la app**: siempre `/app/...`, nunca la ruta pelada (`/profiles` ya no existe, es `/app/profiles`)
