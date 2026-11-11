---
name: 'new-component'
description: 'Scaffolding de nuevo componente React + página Astro + funciones API'
agent: 'frontend-dev'
tools:
  - run_in_terminal
  - file_search
  - grep_search
  - read_file
  - create_file
  - replace_string_in_file
  - get_errors
---

# /new-component — Scaffolding de Componente React + Página Astro

Crea una nueva página completa en el frontend de SueldIA siguiendo los patrones exactos del proyecto.

## Input del Usuario

El usuario debe especificar:
- **Nombre de la página** (ej: "Categories", "Reports", "Settings")
- **Funcionalidad** (ej: "CRUD de categorías", "gráficos de reportes")
- **Datos que muestra** (ej: "lista de categorías con nombre y color")

Si el usuario no proporciona suficiente detalle, preguntar lo necesario.

## Proceso de Generación

### 1. Verificar funciones API

Revisar `frontend/src/lib/api.ts` para confirmar que existen las funciones API necesarias.
Si faltan, crearlas siguiendo el patrón existente.

### 2. Crear componente React

Crear `frontend/src/components/NombrePage.tsx` con el sistema de diseño de `./app` (referencia: `HomeDashboardPage.tsx`, `DashboardPage.tsx`):

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Inbox, Plus } from 'lucide-react';
import { getNombres, createNombre } from '../lib/api';
import { Providers } from './Providers';
import { PageHeader, SectionCard, PageHeaderSkeleton, ListCardSkeleton } from './app';
import { EmptyState } from './ui/EmptyState';
import { Button } from '@/components/ui/button';

function NombreView() {
  const queryClient = useQueryClient();

  // Queries
  const { data, isLoading, error } = useQuery({
    queryKey: ['nombre'],
    queryFn: getNombres,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: createNombre,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nombre'] });
      toast.success('Elemento creado correctamente');
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo crear el elemento'),
  });

  // Loading state (misma geometría que lo real)
  if (isLoading) {
    return (
      <>
        <PageHeaderSkeleton />
        <ListCardSkeleton />
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No se pudieron cargar los datos"
        description="Vuelve a intentarlo en unos segundos."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Título"
        description="Qué ves en esta página."
        actions={
          <Button onClick={() => createMutation.mutate({ name: 'Nuevo' })} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        }
      />
      {data?.length ? (
        <SectionCard className="mt-6" title="Bloque">
          {/* Contenido */}
        </SectionCard>
      ) : (
        // Empty state
        <EmptyState icon={Inbox} title="No hay elementos todavía" description="Crea el primero para empezar." />
      )}
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

### 3. Crear página Astro

Las páginas de la aplicación van siempre bajo `/app`. Crear `frontend/src/pages/app/nombre.astro`:

```astro
---
import Layout from '../../layouts/Layout.astro';
import NombrePage from '../../components/NombrePage.tsx';
---
<Layout title="Título de Página">
  <NombrePage client:load />
</Layout>
```

No añadir `<script>` con manejadores en línea (`onclick="…"`): la CSP con hashes (`frontend/scripts/csp.mjs`) hace fallar el build.

### 4. Actualizar navegación (si aplica)

Si la nueva página necesita aparecer en el menú, añadirla en `frontend/src/components/app/navigation.ts` (única fuente de verdad: aparece sola en sidebar, breadcrumbs y ⌘K). Enlaces internos siempre con `/app/...`.

## Verificación Final

1. Compilar frontend: `npm run build --workspace=frontend` (incluye la CSP)
2. Verificar que la página carga correctamente en dev, en claro y oscuro, y en móvil
