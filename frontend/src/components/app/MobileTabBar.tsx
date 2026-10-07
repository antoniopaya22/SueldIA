import { Ellipsis } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "cn";
import { openNewTransaction } from "@/lib/new-transaction";
import { findWorkspace, getMobileTabs, isActivePath, type NavItem, type WorkspaceMeta } from "./navigation";

// Barra de pestañas inferior en móvil (por debajo de `md`, donde el sidebar
// pasa a ser un panel): lo más usado del espacio al alcance del pulgar, la
// acción principal en el centro y "Más" abre el panel con todo lo demás.
// La altura la fija --mobile-nav-h (global.css) para que lo fijo abajo
// (toasts, barra de selección) quede por encima.

const TAB_CLASS =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg pt-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <a href={item.href} aria-current={active ? "page" : undefined} className={cn(TAB_CLASS, active ? "text-foreground" : "text-muted-foreground")}>
      <Icon className={cn("size-5", active && "text-primary-600 dark:text-primary")} aria-hidden="true" />
      <span className="max-w-full truncate px-0.5">{item.shortLabel ?? item.label}</span>
    </a>
  );
}

export function MobileTabBar({ workspace, currentPath }: { workspace: WorkspaceMeta; currentPath: string }) {
  const { setOpenMobile, openMobile } = useSidebar();
  const tabs = getMobileTabs(workspace);
  const isActive = (item: NavItem) => isActivePath(currentPath, item.href, item.exact);
  // "Más" se marca cuando la página del espacio no tiene pestaña propia (así siempre se sabe dónde se está);
  // en Inicio y Ajustes, que no son de ningún espacio, no se marca nada.
  const moreActive = openMobile || (findWorkspace(currentPath) !== null && !tabs.some(isActive));
  const action = workspace.primaryAction;
  const ActionIcon = action.icon;

  const actionClass =
    "flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/25 outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md supports-backdrop-filter:bg-background/75 md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch gap-1 px-[max(0.5rem,env(safe-area-inset-left))] pb-1.5">
        {tabs.slice(0, 2).map((item) => <Tab key={item.href} item={item} active={isActive(item)} />)}
        <div className="flex flex-1 items-center justify-center">
          {action.opens === "new-transaction" ? (
            <button type="button" onClick={() => openNewTransaction()} className={actionClass} aria-label={action.label}>
              <ActionIcon className="size-6" aria-hidden="true" />
            </button>
          ) : (
            <a href={action.href} className={actionClass} aria-label={action.label}>
              <ActionIcon className="size-6" aria-hidden="true" />
            </a>
          )}
        </div>
        {tabs.slice(2).map((item) => <Tab key={item.href} item={item} active={isActive(item)} />)}
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          aria-label="Más secciones y tu cuenta"
          aria-expanded={openMobile}
          className={cn(TAB_CLASS, "cursor-pointer", moreActive ? "text-foreground" : "text-muted-foreground")}
        >
          <Ellipsis className={cn("size-5", moreActive && "text-primary-600 dark:text-primary")} aria-hidden="true" />
          <span>Más</span>
        </button>
      </div>
    </nav>
  );
}
