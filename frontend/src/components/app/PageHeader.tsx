import type { ReactNode } from "react";
import { cn } from "cn";

interface PageHeaderProps {
  title: ReactNode;
  /** Palabra/frase final en serif itálica (como en la landing). Úsese con moderación. */
  accent?: ReactNode;
  description?: ReactNode;
  /** Texto pequeño encima del título (fecha, contexto). */
  eyebrow?: ReactNode;
  /** Botones/acciones a la derecha. */
  actions?: ReactNode;
  /** Fila opcional bajo el título (filtros, selector de perfil...). */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, accent, description, eyebrow, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 space-y-4 sm:mb-8", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <p className="text-xs font-medium tracking-wide text-muted-foreground">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
            {title}
            {accent && (
              <>
                {" "}
                <span className="font-serif-accent text-[1.12em] text-primary-600 dark:text-primary">{accent}</span>
              </>
            )}
          </h1>
          {/* En móvil se omite: el título ya dice dónde estás y la pantalla es para los datos. */}
          {description && <p className="hidden max-w-2xl text-sm text-muted-foreground sm:block">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
