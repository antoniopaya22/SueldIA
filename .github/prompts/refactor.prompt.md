---
name: 'refactor'
description: 'Análisis y refactoring del código seleccionado manteniendo funcionalidad'
agent: 'agent'
tools:
  - file_search
  - grep_search
  - read_file
  - replace_string_in_file
  - create_file
  - semantic_search
  - get_errors
  - run_in_terminal
---

# /refactor — Refactoring de Código

Analiza el código proporcionado o el archivo actual y propone refactorings que mejoren la calidad sin cambiar la funcionalidad.

## Áreas de Mejora

### Estructura y Organización
- Funciones demasiado largas (> 50 líneas) → extraer funciones auxiliares
- Archivos demasiado grandes (> 300 líneas) → considerar dividir
- Código duplicado → extraer función reutilizable
- Responsabilidades mixtas → separar por concern

### Legibilidad
- Variables con nombres poco descriptivos → renombrar
- Nesting profundo (> 3 niveles) → early returns, extraer funciones
- Condicionales complejas → extraer a funciones con nombre descriptivo
- Magic numbers/strings → extraer a constantes con nombre

### Patrones del Proyecto
- Backend: ¿sigue el patrón de handler async + try/catch + next(err)?
- Backend: ¿usa Zod para validación, con los helpers compartidos (`isoDateSchema`, `moneySchema`, `toCsv`, `assertUnderLimit`) en vez de reimplementarlos?
- Backend: ¿queries Drizzle asíncronas (`const [row] = await ...`, `.returning()`) y filtradas por `userId`?
- Frontend: ¿usa React Query para data fetching (no useEffect+fetch)?
- Frontend: ¿maneja loading/error/empty states?
- Frontend: ¿envuelve con Providers?
- Frontend: ¿usa el sistema de diseño de `components/app/` y los componentes de `components/ui/` en vez de markup suelto?

### TypeScript
- `any` → reemplazar con tipo específico o `unknown`
- Type assertions innecesarias → mejorar inferencia
- Interfaces faltantes para API payloads
- Generics que simplifiquen código repetitivo

### Performance
- Queries N+1 → joins o batch queries
- Re-renders innecesarios → `useMemo`, `useCallback` donde aplique
- Bundle: imports que traen toda la librería → imports específicos

## Proceso

1. **Leer** el código a refactorizar (archivo completo o sección)
2. **Identificar** las oportunidades de mejora
3. **Priorizar** por impacto (legibilidad > performance > estilo)
4. **Presentar** los cambios propuestos con justificación
5. **Implementar** los cambios aprobados
6. **Verificar** que compila y pasa las pruebas: `npm run build`, `npm run typecheck`, `npm test`

## Formato de Propuesta

```markdown
## Cambio 1: [título]
**Tipo**: legibilidad | estructura | performance | tipos | patrones
**Impacto**: alto | medio | bajo
**Justificación**: [por qué este cambio mejora el código]

### Antes
[código actual]

### Después
[código propuesto]
```

## Reglas

- **No cambiar funcionalidad** — el refactor debe ser transparente
- **No cambiar APIs públicas** sin aprobación (endpoints, props de componentes)
- **Seguir patrones existentes** del proyecto, no inventar nuevos
- **Cambios incrementales** — preferir múltiples pequeños cambios a uno grande
