import { useRef, type ElementType, type ReactNode } from "react";
import { cn } from "cn";
import type { ExportTable } from "@/lib/export-utils";
import { ChartExportMenu } from "./ChartExportMenu";

interface SectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ElementType;
  /** Acción en la cabecera (enlace "Ver todo", Segmented, Select...). */
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Sin padding en el cuerpo (tablas y listas a sangre). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
}

// Contenedor base de la app: card blanca con borde fino, cabecera opcional.
export function SectionCard({ title, description, icon: Icon, action, children, footer, flush, className, bodyClassName }: SectionCardProps) {
  const hasHeader = title || description || action;
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.03)]", className)}>
      {hasHeader && (
        <div className={cn("flex items-start justify-between gap-3 px-5 pt-5", flush && "pb-4 border-b border-border")}>
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
              {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn("flex-1", !flush && "p-5", !flush && hasHeader && "pt-4", bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}

interface ChartCardProps extends Omit<SectionCardProps, "flush"> {
  /** Alto del área del gráfico en px (el ResponsiveContainer usa 100%). */
  height?: number;
  /** Leyenda/resumen bajo el gráfico. */
  legend?: ReactNode;
  /** Datos del gráfico tal y como se ven: con ellos la tarjeta ofrece descargar PNG y CSV. */
  exportTable?: () => ExportTable | null;
}

export function ChartCard({ height = 280, legend, children, exportTable, action, ...props }: ChartCardProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const exportTitle = typeof props.title === "string" ? props.title : "Gráfico";
  const exportMenu = exportTable ? <ChartExportMenu title={exportTitle} rootRef={chartRef} exportTable={exportTable} /> : null;
  return (
    <SectionCard {...props} action={exportMenu ? <>{action}{exportMenu}</> : action}>
      <div ref={chartRef} style={{ height }} className="w-full">
        {children}
      </div>
      {legend && <div className="mt-4">{legend}</div>}
    </SectionCard>
  );
}

/** Enlace de cabecera tipo "Ver todo →". */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </a>
  );
}
