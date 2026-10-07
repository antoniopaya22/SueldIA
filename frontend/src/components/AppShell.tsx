import * as React from "react";
import { Bell, Check, ChevronsUpDown, LogOut, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { supabase } from "@/lib/supabase";
import {
  clearAuth, getAlertHistory, getMe, markAlertRead, markAllAlertsRead, type AlertHistoryItem,
} from "@/lib/api";
import { formatRelativeDate } from "@/lib/format";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { CommandMenu } from "@/components/app/CommandMenu";
import { PreferencesBoot } from "@/components/app/PreferencesBoot";
import { MobileTabBar } from "@/components/app/MobileTabBar";
import { QueryClientProvider } from "@tanstack/react-query";
import { TransactionFormDialog } from "@/components/finance-manage/transactions/TransactionFormDialog";
import type { TxForm } from "@/components/finance-manage/transactions/TransactionDialog";
import { appQueryClient } from "@/lib/query-client";
import { NEW_TRANSACTION_EVENT, openNewTransaction, type NewTransactionType } from "@/lib/new-transaction";
import {
  HOME_ITEM,
  SETTINGS_ITEM,
  WORKSPACES,
  DEFAULT_WORKSPACE,
  findWorkspace,
  getActiveWorkspace,
  getBreadcrumbTrail,
  groupNavItems,
  isActivePath,
  type NavItem,
  type WorkspaceMeta,
} from "@/components/app/navigation";

// ─── Marca ──────────────────────────────────────────────────────
function BrandMark({ className }: { className?: string }) {
  return <img src="/logo-mark.svg" alt="" className={cn("aspect-square size-8 shrink-0", className)} />;
}

function Wordmark() {
  return (
    <span className="font-semibold tracking-tight">
      Sueld<span className="text-primary-500 dark:text-primary">IA</span>
    </span>
  );
}

// ─── Espacios de trabajo ───────────────────────────────────────
function WorkspaceSwitcher({ active }: { active: WorkspaceMeta }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <BrandMark />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <Wordmark />
              <span className="truncate text-xs text-sidebar-foreground/75">{active.label}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/40" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--anchor-width) min-w-60 rounded-xl p-1.5" align="start" side="bottom" sideOffset={6}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 text-[11px]">Espacios de trabajo</DropdownMenuLabel>
              {WORKSPACES.map((ws) => (
                <DropdownMenuItem key={ws.key} render={<a href={ws.href} />} className="gap-2.5 rounded-lg p-2">
                  <div
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg border",
                      ws.key === active.key ? "border-primary/30 bg-primary/10 text-primary-700 dark:text-primary" : "border-border bg-muted/60 text-muted-foreground",
                    )}
                  >
                    <ws.icon className="size-4 shrink-0" />
                  </div>
                  <div className="grid flex-1 leading-tight">
                    <span className="text-sm font-medium">{ws.label}</span>
                    <span className="text-xs text-muted-foreground">{ws.description}</span>
                  </div>
                  {ws.key === active.key && <Check className="size-4 text-primary-600 dark:text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// Item activo: "pastilla" blanca con anillo fino e icono en verde de marca.
const NAV_BUTTON_CLASS =
  "h-9 gap-2.5 text-sidebar-foreground/75 hover:text-sidebar-foreground [&>svg]:text-sidebar-foreground/55 hover:[&>svg]:text-sidebar-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_1px_2px_rgb(0_0_0/0.06)] data-active:ring-1 data-active:ring-sidebar-border data-active:[&>svg]:text-primary-600 dark:data-active:bg-sidebar-accent dark:data-active:[&>svg]:text-primary";

function NavLink({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<a href={item.href} />}
        isActive={isActivePath(currentPath, item.href, item.exact)}
        tooltip={item.label}
        className={NAV_BUTTON_CLASS}
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ─── Usuario ────────────────────────────────────────────────────
interface ShellUser {
  name: string;
  email: string;
  avatarUrl?: string;
}

// Nombre/email/avatar salen de la sesión de Supabase (Google); si no hay
// sesión (desarrollo local con la API simulada) se cae a /auth/me.
function useShellUser(): ShellUser | null {
  const [user, setUser] = React.useState<ShellUser | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    let fromSession = false;
    // En paralelo: la sesión aporta el avatar de Google; /auth/me cubre el
    // caso sin sesión (desarrollo local con la API simulada).
    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      if (!sessionUser || cancelled) return;
      fromSession = true;
      const meta = sessionUser.user_metadata ?? {};
      setUser({
        name: meta.full_name ?? meta.name ?? sessionUser.email ?? "",
        email: sessionUser.email ?? "",
        avatarUrl: meta.avatar_url ?? meta.picture,
      });
    });
    getMe()
      .then((me) => {
        if (!cancelled && !fromSession) setUser({ name: me.name, email: me.email });
      })
      .catch(() => {
        // Sin sesión ni API: el menú se muestra sin datos.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return user;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

function NavUser() {
  const user = useShellUser();
  const { preference, setPreference } = useTheme();
  const { isMobile } = useSidebar();

  const logout = async () => {
    await clearAuth();
    // A la landing, no a /login: quien cierra sesión a propósito no
    // necesita ver el formulario de entrar otra vez de inmediato.
    window.location.href = "/";
  };

  const avatar = (
    <Avatar className="size-8 rounded-lg">
      {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="rounded-lg bg-primary/12 text-xs font-semibold text-primary-700 dark:text-primary">
        {initialsOf(user?.name ?? "")}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip="Tu cuenta"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            {avatar}
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user?.name || "Tu cuenta"}</span>
              <span className="truncate text-xs text-sidebar-foreground/75">{user?.email}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/40" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-60 rounded-xl p-1.5"
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
          >
            <div className="flex items-center gap-2.5 px-2 py-2">
              {avatar}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user?.name || "Tu cuenta"}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<a href={SETTINGS_ITEM.href} />} className="gap-2 rounded-lg px-2 py-1.5">
                <Settings className="size-4" />
                Ajustes
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 text-[11px]">Tema</DropdownMenuLabel>
              <div className="grid grid-cols-3 gap-1 px-1 pb-1" role="radiogroup" aria-label="Tema">
                {THEME_OPTIONS.map((opt) => {
                  const selected = preference === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPreference(opt.value)}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <opt.icon className={cn("size-4", selected && "text-primary-600 dark:text-primary")} />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={logout} className="gap-2 rounded-lg px-2 py-1.5 text-destructive focus:text-destructive">
                <LogOut className="size-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── Campana de notificaciones ─────────────────────────────────
// Isla propia sin QueryClientProvider (ver NavUser más arriba): mismo patrón
// de fetch simple con useState/useEffect, no React Query.
const BELL_SEVERITY_CLASS: Record<AlertHistoryItem["severity"], string> = {
  info: "text-muted-foreground bg-muted",
  warning: "text-amber-700 bg-amber-500/10 dark:text-amber-400",
  critical: "text-red-700 bg-red-500/10 dark:text-red-400",
};

function NotificationBell() {
  const [alerts, setAlerts] = React.useState<AlertHistoryItem[]>([]);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(() => {
    getAlertHistory({ unread: true })
      .then(setAlerts)
      .catch(() => {
        // Sin sesión ni API: la campana se muestra vacía.
      });
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  const count = alerts.length;

  const markOne = async (id: number) => {
    try {
      await markAlertRead(id);
      refresh();
    } catch {
      // Acción ambiental: sin toast si falla, se reintentará al reabrir.
    }
  };

  const markAll = async () => {
    try {
      await markAllAlertsRead();
      refresh();
    } catch {
      // Igual que arriba.
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) refresh(); }}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" aria-label="Alertas" />}
      >
        <Bell className="size-4" />
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background"
            aria-hidden="true"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
          <p className="text-sm font-semibold text-foreground">Alertas</p>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={count === 0} onClick={markAll}>
            Marcar todas
          </Button>
        </div>
        {count === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">Sin alertas nuevas</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10px] font-medium", BELL_SEVERITY_CLASS[a.severity] ?? BELL_SEVERITY_CLASS.info)}>
                  {a.severity === "critical" ? "Importante" : a.severity === "warning" ? "Atención" : "Aviso"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground">{a.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatRelativeDate(a.createdAt)}</p>
                </div>
                <Button variant="ghost" size="icon-xs" aria-label="Marcar leída" onClick={() => markOne(a.id)}>
                  <Check className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-3.5 py-2.5">
          <a href="/app/alerts" className="text-xs font-medium text-primary-600 hover:underline dark:text-primary">
            Ver todas las alertas
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Cabecera ───────────────────────────────────────────────────
function AppHeader({ currentPath, onOpenSearch }: { currentPath: string; onOpenSearch: () => void }) {
  const crumbs = getBreadcrumbTrail(currentPath);
  // En Inicio/Ajustes la acción rápida es subir nómina; nunca se muestra en su propia página.
  const action = (findWorkspace(currentPath) ?? DEFAULT_WORKSPACE).primaryAction;
  const showAction = !isActivePath(currentPath, action.href.split("?")[0]);
  const ActionIcon = action.icon;

  return (
    <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-border/70 bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-backdrop-filter:bg-background/65 sm:px-5">
      {/* En móvil el panel se abre desde "Más" en la barra inferior. */}
      <SidebarTrigger className="-ml-1 hidden text-muted-foreground hover:text-foreground md:inline-flex" />
      <div aria-hidden="true" className="mr-1 hidden h-4 w-px shrink-0 bg-border md:block" />
      <a href={HOME_ITEM.href} className="md:hidden" aria-label="Inicio">
        <BrandMark className="size-6" />
      </a>
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <React.Fragment key={crumb.label}>
                {i > 0 && <BreadcrumbSeparator className={cn(!last && "hidden sm:flex")} />}
                <BreadcrumbItem className={cn(!last && "hidden sm:inline-flex")}>
                  {crumb.href && !last ? (
                    <BreadcrumbLink render={<a href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex size-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card/70 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-card hover:text-foreground md:h-8 md:w-56 md:justify-start md:px-2.5"
          aria-label="Buscar (Ctrl+K)"
        >
          <Search className="size-4" />
          <span className="hidden flex-1 text-left md:inline">Buscar…</span>
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-px text-[10px] font-medium md:inline">⌘K</kbd>
        </button>
        <NotificationBell />
        {showAction && (action.opens === "new-transaction" ? (
          <button
            type="button"
            onClick={() => openNewTransaction()}
            className={cn(buttonVariants({ size: "sm" }), "hidden h-8 cursor-pointer gap-1.5 px-3 md:inline-flex")}
            aria-label={action.label}
            title={`${action.label} (N)`}
          >
            <ActionIcon className="size-4" />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        ) : (
          <a href={action.href} className={cn(buttonVariants({ size: "sm" }), "hidden h-8 gap-1.5 px-3 md:inline-flex")}>
            <ActionIcon className="size-4" />
            <span className="hidden sm:inline">{action.label}</span>
          </a>
        ))}
      </div>
    </header>
  );
}

// ─── Shell ──────────────────────────────────────────────────────
// El sitio es HTML estático (sin SSR): la cookie `sidebar_state` que escribe
// ui/sidebar.tsx se lee tras montar para no provocar hydration mismatch.
function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|; )sidebar_state=(true|false)/);
  return match ? match[1] === "true" : true;
}

interface AppShellProps {
  currentPath: string;
  children?: React.ReactNode;
}

export function AppShell({ currentPath, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [searchOpen, setSearchOpen] = React.useState(false);
  // Nueva transacción global: el diálogo se monta la primera vez que se pide
  // (así las páginas sin finanzas no cargan cuentas ni categorías de más).
  const [txDialog, setTxDialog] = React.useState<{ open: boolean; mounted: boolean; initial?: Partial<TxForm> }>({
    open: false,
    mounted: false,
  });
  React.useEffect(() => {
    setSidebarOpen(readSidebarCookie());
  }, []);

  React.useEffect(() => {
    const open = (type: NewTransactionType = "expense") =>
      setTxDialog({ open: true, mounted: true, initial: { type } });

    const onRequest = (e: Event) => open((e as CustomEvent<{ type?: NewTransactionType }>).detail?.type);

    // Atajo "N": solo si no se está escribiendo ni hay otro diálogo abierto.
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='combobox']")) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      e.preventDefault();
      open();
    };

    // Compatibilidad con enlaces antiguos /app/transactions?nueva=1: se consume y se quita de la URL.
    const params = new URLSearchParams(window.location.search);
    if (params.has("nueva")) {
      params.delete("nueva");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      open();
    }

    window.addEventListener(NEW_TRANSACTION_EVENT, onRequest);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(NEW_TRANSACTION_EVENT, onRequest);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeWorkspace = getActiveWorkspace(currentPath);

  return (
    <TooltipProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <Sidebar collapsible="icon" variant="inset">
          <SidebarHeader className="pb-0">
            <WorkspaceSwitcher active={activeWorkspace} />
          </SidebarHeader>
          <SidebarContent className="pt-2">
            <SidebarGroup className="py-1">
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavLink item={HOME_ITEM} currentPath={currentPath} />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {groupNavItems(activeWorkspace.items).map((group) => (
              <SidebarGroup key={group.label ?? activeWorkspace.label} className="py-1">
                <SidebarGroupLabel className="text-[11px] tracking-wide text-sidebar-foreground/75">{group.label ?? activeWorkspace.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {group.items.map((item) => (
                      <NavLink key={item.href} item={item} currentPath={currentPath} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <NavUser />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="md:h-[calc(100svh-1rem)] md:overflow-hidden md:ring-1 md:ring-black/[0.04] dark:md:ring-white/[0.06]">
          <div className="flex min-h-0 flex-1 flex-col md:overflow-y-auto">
            <AppHeader currentPath={currentPath} onOpenSearch={() => setSearchOpen(true)} />
            <div className="app-page mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-[calc(var(--mobile-nav-h)+1.5rem)] sm:px-6 sm:pt-6 md:pb-6 lg:px-10 lg:py-9">{children}</div>
          </div>
        </SidebarInset>
        <MobileTabBar workspace={activeWorkspace} currentPath={currentPath} />
        <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
        <QueryClientProvider client={appQueryClient}>
          <PreferencesBoot />
          {txDialog.mounted && (
            <TransactionFormDialog
              open={txDialog.open}
              onClose={() => setTxDialog((d) => ({ ...d, open: false }))}
              editing={null}
              initial={txDialog.initial}
            />
          )}
        </QueryClientProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
