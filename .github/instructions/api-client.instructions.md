---
name: 'API Client'
description: 'Patrones para el cliente API centralizado del frontend'
applyTo: 'frontend/src/lib/**'
---

# API Client — Frontend

## Arquitectura

Todo acceso a la API del backend pasa por `frontend/src/lib/api.ts`. Los componentes NUNCA hacen `fetch()` directo. En producción `/api/*` llega al backend por un rewrite de Vercel (mismo origen); en desarrollo, por el proxy de Vite.

## Función Base `request()`

```typescript
import { supabase } from './supabase';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await clearAuth();
      window.location.href = '/login';
    }
    throw new Error(body.error ?? (res.status === 401 ? 'No autorizado' : `HTTP ${res.status}`));
  }
  return res.json();
}
```

## Patrón para Nuevas Funciones API

Agrupar por dominio con named exports (arrow functions sobre `request<T>`). Los listados paginados devuelven `Paginated<T>` (`{ data, total, page, limit }`):

```typescript
// ─── Profiles ───────────────────────────────────────────────────
export interface Profile {
  id: number;
  name: string;
  color: string;
  createdAt: string;
}

export const getProfiles = () =>
  request<Paginated<Profile>>('/profiles').then((r) => r.data);

export const createProfile = (data: { name: string; color?: string }) =>
  request<Profile>('/profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
```

## Casos Especiales

### Uploads (FormData)
No usar `request()` — usar `fetch()` directo sin `Content-Type` (el navegador lo pone con el boundary), pero con el mismo token y el mismo manejo del 401. El backend procesa el PDF en memoria (no se guarda) y el límite es ~4 MB por petición (Vercel), así que el frontend sube un archivo por petición:

```typescript
export const uploadPayslips = async (profileId: number, files: File[], payslipType: 'ordinal' | 'extra' = 'ordinal') => {
  const formData = new FormData();
  formData.append('profileId', String(profileId));
  formData.append('payslipType', payslipType);
  files.forEach((f) => formData.append('files', f));

  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/payslips/upload`, { method: 'POST', body: formData, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      await clearAuth();
      window.location.href = '/login';
    }
    throw new Error(body.error ?? 'Error al subir los archivos');
  }
  return res.json() as Promise<Payslip[]>;
};
```

### Descargas (Blob)
Para exportar archivos (CSV/JSON), usar `fetch()` directo y crear un enlace de descarga:

```typescript
export const exportAllData = async () => {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/export/all`, { headers });
  if (!res.ok) throw new Error('No se pudo exportar los datos');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sueldia-datos.json';
  a.click();
  URL.revokeObjectURL(url);
};
```

## Gestión del Token

La sesión la gestiona el cliente de Supabase (`src/lib/supabase.ts`), incluido el refresco del token. No se guarda nada en `localStorage` propio ni hay `setAuthToken`:

```typescript
export async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function clearAuth() {
  await supabase.auth.signOut();
}
```

## Reglas

- Siempre tipar la respuesta con generics: `request<T>(path)`
- Definir interfaces para payloads de request y response junto a las funciones
- Fechas de negocio como `string` `YYYY-MM-DD`; importes como `number`
- Mensajes de error en español
- Todo nuevo endpoint del backend necesita su función correspondiente aquí
- No añadir llamadas a dominios externos: la CSP (`connect-src`) solo permite el propio origen y Supabase
