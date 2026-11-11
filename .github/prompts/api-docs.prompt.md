---
name: 'api-docs'
description: 'Genera documentación de un endpoint de la API REST del backend'
agent: 'agent'
tools:
  - file_search
  - grep_search
  - read_file
  - semantic_search
---

# /api-docs — Documentación de API

Genera documentación completa para endpoints del API REST de SueldIA.

## Input del Usuario

El usuario puede especificar:
- **Un endpoint específico**: "documenta POST /api/payslips/upload"
- **Un archivo de rutas**: "documenta todas las rutas de alerts.ts"
- **Toda la API**: "documenta todos los endpoints"

## Proceso

1. **Leer** el archivo de ruta relevante en `backend/src/routes/`
2. **Identificar** cada endpoint (método + path)
3. **Extraer** de cada handler:
   - Schemas Zod de validación (→ body params)
   - Query params parseados
   - URL params (`:id`, etc.)
   - Shape de la respuesta
   - Status codes posibles
   - Si requiere autenticación
4. **Generar documentación** en formato estructurado

## Formato por Endpoint

```markdown
### METHOD /api/path

**Descripción**: [qué hace el endpoint]
**Autenticación**: Requerida / Pública

#### Parámetros URL
| Param | Tipo | Descripción |
|-------|------|-------------|
| id | number | ID del recurso |

#### Query Params
| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| page | number | 1 | Número de página |
| limit | number | 20 | Items por página |

#### Body (JSON)
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| name | string | Sí | Nombre del recurso |

#### Respuesta Exitosa (200/201)
​```json
{
  "id": 1,
  "name": "Ejemplo",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
​```

#### Errores
| Status | Descripción |
|--------|-------------|
| 400 | Datos inválidos (validación Zod) |
| 401 | No autenticado |
| 404 | Recurso no encontrado |
```

## Reglas

- Documentar **solo lo que el código realmente hace** — no inventar funcionalidad
- Incluir ejemplos realistas basados en el schema de la base de datos
- Si un endpoint lee query params, documentar todos los filtros soportados
- Para endpoints de upload, documentar el formato multipart/form-data (campo `files`, solo PDF, ~4 MB por petición; el archivo se procesa en memoria y no se guarda)
- Autenticación: `Authorization: Bearer <access_token de Supabase>`; las rutas sin `authMiddleware` en `backend/src/index.ts` son públicas (`/api/cron` va con `CRON_SECRET`)
- Mensajes de error en español (así están en el código)
