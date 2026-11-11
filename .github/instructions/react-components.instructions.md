---
name: 'React Components'
description: 'Patrones y convenciones para componentes React en el frontend'
applyTo: 'frontend/src/components/**'
---

# Patrones React — Frontend

Fuente de verdad: [`frontend/AGENTS.md`](../../frontend/AGENTS.md). Referencias reales: `HomeDashboardPage.tsx`, `DashboardPage.tsx`.

## Estructura de Componente de Página

Cada componente de página tiene dos partes:

### 1. Inner View (named function)
Contiene toda la lógica, data fetching y UI, construida con el sistema de diseño de `./app`:
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Users } from 'lucide-react';
import { getProfiles, createProfile } from '../lib/api';
import { PageHeader, SectionCard, PageHeaderSkeleton, ListCardSkeleton } from './app';
import { EmptyState } from './ui/EmptyState';

function ProfilesView() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['profiles'], queryFn: getProfiles });

  const mutation = useMutation({
    mutationFn: createProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success('Perfil creado');
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo crear el perfil'),
  });

  if (isLoading) return <><PageHeaderSkeleton /><ListCardSkeleton /></>;
  if (error) {
    return <EmptyState icon={AlertTriangle} title="No se pudieron cargar los perfiles" description="Vuelve a intentarlo en unos segundos." />;
  }

  return (
    <div>
      <PageHeader title="Perfiles" description="Personas cuyas nóminas gestionas." />
      {data?.length ? (
        <SectionCard className="mt-6" title="Todos">{/* lista */}</SectionCard>
      ) : (
        <EmptyState icon={Users} title="Aún no hay perfiles" description="Crea uno para empezar a subir nóminas." />
      )}
    </div>
  );
}
```

### 2. Default Export (wrapper con Providers)
```tsx
export default function ProfilesPage() {
  return (
    <Providers>
      <ProfilesView />
    </Providers>
  );
}
```

## Data Fetching

- **Siempre** usar React Query (`useQuery` / `useMutation`)
- **Nunca** hacer `fetch()` directo en componentes
- **Nunca** usar `useEffect` + `useState` para data fetching
- Importar funciones API desde `../lib/api`
- `queryKey` debe ser un array descriptivo: `['payslips', { profileId, year }]`
- Después de mutaciones exitosas: `queryClient.invalidateQueries()`

## Estados Obligatorios

Toda vista que carga datos DEBE manejar estos 3 estados:

1. **Loading**: skeletons de `./app` (`PageHeaderSkeleton`, `StatCardSkeleton`, `ChartCardSkeleton`, `ListCardSkeleton`) con la misma geometría que lo real
2. **Error**: `EmptyState` (o mensaje) claro en español, con opción de reintentar si aplica
3. **Empty**: `EmptyState` con CTA cuando no hay datos ("Sube tu primera nómina")

## Toast Notifications

Con `sonner` (el `<Toaster />` ya está en `Providers`). No existe `useToast`/`ToastProvider`:

```tsx
import { toast } from 'sonner';

toast.success('Nómina subida correctamente');
toast.error('No se pudo procesar la nómina');
toast.info('Procesando archivos...');
```

## Estilado

- Componentes de `@/components/ui/*` (shadcn sobre **Base UI**: polimorfismo con la prop `render`, no `asChild`; para un enlace con pinta de botón, `buttonVariants({...})` sobre `<a>`)
- Tokens semánticos que se adaptan solos a dark mode: `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`… Nada de colores hex sueltos ni azul fijo
- Clases heredadas (`.card`, `.btn-primary`, `.input`, `.badge`, `.skeleton`) solo en páginas que ya las usan
- Importes con `tabular-nums`; formateo con `lib/format.ts` (`formatCurrency`, `formatPct`…), nunca `toFixed` para mostrar
- Gráficas con `chart-theme.ts` (`chartGrid`, `chartAxis`, `chartColors`…); colores elegidos por el usuario vía `lib/color.ts` (`adaptiveColor`)
- Responsive: mobile-first (`sm:`, `md:`, `lg:`); lo fijo abajo suma `var(--mobile-nav-h)`
- **CSP**: nada de manejadores en línea en HTML/Astro (`onclick="…"`); en React, `onClick={...}` es correcto

## Iconos

Importar individualmente desde `lucide-react`:
```tsx
import { Upload, Trash2, Pencil, Plus, Search, Filter } from 'lucide-react';
// Uso: <Upload className="h-5 w-5" />
```

## Auth

Acceder al estado de autenticación (sesión de Supabase, login con Google):
```tsx
const { user, loading, logout } = useAuth();
```

No implementar guardias de ruta en componentes — la protección es a nivel API (401 → `signOut()` + redirect a `/login` automático desde `lib/api.ts`).
