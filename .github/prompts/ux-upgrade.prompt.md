---
name: 'ux-upgrade'
description: 'Analiza componentes React y propone mejoras de UX, accesibilidad y responsive design'
agent: 'agent'
tools:
  - file_search
  - grep_search
  - read_file
  - semantic_search
  - get_errors
  - replace_string_in_file
  - create_file
  - run_in_terminal
---

# /ux-upgrade — Mejoras de UX

Analiza los componentes React del frontend de SueldIA y propone (e implementa si se aprueba) mejoras de experiencia de usuario.

## Áreas de Análisis

### 1. Loading States
- ¿Se muestra skeleton mientras cargan los datos (`PageHeaderSkeleton`, `StatCardSkeleton`, `ChartCardSkeleton`, `ListCardSkeleton` de `components/app/`)?
- ¿Los skeletons reflejan la estructura real del contenido?
- ¿Hay indicación de progreso en operaciones largas (upload, parsing)?
- ¿Se deshabilitan botones durante operaciones en curso?

### 2. Error Handling UX
- ¿Los errores muestran mensajes claros en español?
- ¿Se ofrecen acciones de recuperación (reintentar, volver)?
- ¿Los errores de formulario se muestran inline junto al campo?
- ¿Hay un estado de error general para la página?

### 3. Empty States
- ¿Se muestra un mensaje amigable cuando no hay datos (`ui/EmptyState`)?
- ¿Se ofrece una CTA (call to action) para empezar? ("Sube tu primera nómina")
- ¿El empty state tiene ilustración o icono?

### 4. Feedback y Confirmación
- ¿Las acciones exitosas muestran toast de confirmación (`sonner`)?
- ¿Las acciones destructivas (eliminar) piden confirmación (`AlertDialog`)?
- ¿Hay feedback inmediato al hacer click (estados presionado/hover)?

### 5. Accesibilidad (a11y)
- ¿Botones e inputs tienen labels visibles o `aria-label`?
- ¿Se puede navegar con teclado (Tab, Enter, Escape)?
- ¿Los colores tienen contraste suficiente?
- ¿Las imágenes/iconos tienen alt text o `aria-hidden`?
- ¿Se usan roles semánticos (`role`, `aria-live` para notificaciones)?

### 6. Responsive Design
- ¿La UI funciona correctamente en móvil (< 640px)?
- ¿Las tablas se adaptan o se transforman en cards en mobile?
- ¿Los modales son usables en pantallas pequeñas (`DialogContent` sale como hoja desde abajo en móvil)?
- ¿Lo fijo abajo suma `var(--mobile-nav-h)` para no quedar tapado por la barra de pestañas?
- ¿El texto es legible sin hacer zoom?

### 7. Micro-interacciones
- ¿Hay transiciones suaves en cambios de estado?
- ¿Los hover states son claros y consistentes?
- ¿Las animaciones respetan `prefers-reduced-motion`?

## Formato del Reporte

```markdown
## Componente: [nombre]

### ✅ Bien hecho
- [aspectos positivos actuales]

### 🔧 Mejoras propuestas

#### 1. [Título de mejora]
**Impacto**: alto | medio | bajo
**Esfuerzo**: bajo | medio | alto
**Detalle**: [descripción de la mejora]
**Código**: [snippet del cambio propuesto]
```

## Después del Análisis

Preguntar al usuario qué mejoras quiere implementar y aplicarlas.
Referenciar las convenciones de [componentes React](../instructions/react-components.instructions.md) y el sistema de diseño y tokens de [`frontend/AGENTS.md`](../../frontend/AGENTS.md). Nada de manejadores en línea en HTML/Astro (CSP).
