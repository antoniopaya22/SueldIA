---
name: 'commit'
description: 'Genera un mensaje de commit convencional analizando los cambios staged'
agent: 'agent'
tools:
  - run_in_terminal
  - read_file
  - grep_search
---

# /commit — Generar Mensaje de Commit

Analiza los cambios staged en git y genera un mensaje de commit siguiendo Conventional Commits.

## Instrucciones

1. Ejecuta `git diff --cached --stat` para ver qué archivos cambiaron
2. Ejecuta `git diff --cached` para ver los cambios detallados
3. Analiza los cambios y determina:
   - **Tipo**: `feat` (nueva feature), `fix` (bug fix), `refactor` (reorganización), `docs` (documentación), `chore` (mantenimiento), `test` (tests), `style` (formato), `perf` (performance)
   - **Scope**: `backend`, `frontend`, `db`, `parsers`, `auth`, `api`, `ui`, `deps` (los de `AGENTS.md`)
   - **Descripción**: resumen breve en **español**
4. Si los cambios son complejos, incluye un cuerpo con más detalle

## Formato

```
tipo(scope): descripción breve en español

[cuerpo opcional — explicar qué y por qué, no cómo]
```

## Ejemplos

```
feat(backend): añadir endpoint de exportación de nóminas a CSV

fix(parsers): corregir regex de extracción de salario bruto que fallaba con decimales

refactor(frontend): extraer lógica de filtrado a hook reutilizable

chore(deps): actualizar dependencias de seguridad

docs(api): documentar endpoints de alertas
```

## Reglas

- Si no hay cambios staged (`git diff --cached` vacío), indica al usuario que haga `git add` primero
- Un commit debe representar un cambio atómico y coherente
- Si los cambios abarcan múltiples áreas no relacionadas, sugiere dividir en commits separados
- Descripción en español, máximo ~72 caracteres en la primera línea
- NO ejecutar `git commit` — solo generar el mensaje para que el usuario lo revise
