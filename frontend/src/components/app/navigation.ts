import {
  Home, Wallet, ChartColumn, Landmark, Tags, Receipt, ArrowDownToLine,
  FileText, Upload, Users, Settings, PieChart, Plus, Bell, PiggyBank, FileChartColumn, type LucideIcon,
} from "lucide-react";

// Única fuente de verdad de la navegación de /app/*: sidebar, breadcrumbs,
// acción contextual de la cabecera y paleta de comandos se derivan de aquí.

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Palabras extra para la búsqueda de la paleta de comandos. */
  keywords?: string;
}

export type WorkspaceKey = "finanzas" | "nominas";

export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Si está, la acción abre este diálogo en el sitio en vez de navegar a `href` (que queda de enlace de respaldo). */
  opens?: "new-transaction";
}

export interface WorkspaceMeta {
  key: WorkspaceKey;
  label: string;
  description: string;
  icon: LucideIcon;
  href: string;
  items: NavItem[];
  /** Acción principal que muestra la cabecera dentro de este espacio. */
  primaryAction: QuickAction;
}

export const HOME_ITEM: NavItem = { href: "/app", label: "Inicio", icon: Home, exact: true, keywords: "resumen dashboard" };
export const SETTINGS_ITEM: NavItem = { href: "/app/settings", label: "Ajustes", icon: Settings, keywords: "cuenta perfil tema" };

export const WORKSPACES: WorkspaceMeta[] = [
  {
    key: "finanzas",
    label: "Finanzas",
    description: "Cuentas, gastos e ingresos",
    icon: Wallet,
    href: "/app/finance",
    primaryAction: { label: "Nueva transacción", href: "/app/transactions?nueva=1", icon: Plus, opens: "new-transaction" },
    items: [
      { href: "/app/finance", label: "Dashboard", icon: Wallet, exact: true, keywords: "finanzas resumen" },
      { href: "/app/finance/analytics", label: "Analítica", icon: PieChart, keywords: "finanzas gráficos gastos" },
      { href: "/app/finance/report", label: "Informe del mes", icon: FileChartColumn, keywords: "informe resumen mes comparar media inusual" },
      { href: "/app/accounts", label: "Cuentas", icon: Landmark, keywords: "banco tarjeta saldo" },
      { href: "/app/categories", label: "Categorías", icon: Tags, keywords: "grupos" },
      { href: "/app/budget", label: "Presupuesto", icon: PiggyBank, keywords: "presupuesto categorías asignar" },
      { href: "/app/transactions", label: "Transacciones", icon: Receipt, keywords: "movimientos gastos ingresos" },
      { href: "/app/import", label: "Importar", icon: ArrowDownToLine, keywords: "ynab csv" },
    ],
  },
  {
    key: "nominas",
    label: "Nóminas",
    description: "Salarios, retenciones y análisis",
    icon: FileText,
    href: "/app/payroll",
    primaryAction: { label: "Subir nómina", href: "/app/upload", icon: Upload },
    items: [
      { href: "/app/payroll", label: "Dashboard", icon: ChartColumn, keywords: "nóminas resumen salario" },
      { href: "/app/upload", label: "Subir nóminas", icon: Upload, keywords: "pdf" },
      { href: "/app/payslips", label: "Mis nóminas", icon: FileText, keywords: "listado pdf" },
      { href: "/app/analytics", label: "Analítica", icon: PieChart, keywords: "nóminas tendencias predicción" },
      { href: "/app/profiles", label: "Perfiles", icon: Users, keywords: "personas" },
      { href: "/app/alerts", label: "Alertas", icon: Bell, keywords: "notificaciones avisos reglas" },
    ],
  },
];

export function normalizePath(path: string): string {
  return path !== "/app" && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function isActivePath(currentPath: string, href: string, exact = false): boolean {
  const normalized = normalizePath(currentPath);
  if (href === "/app") return normalized === "/app";
  if (exact) return normalized === href;
  return normalized === href || normalized.startsWith(`${href}/`);
}

/** Espacio de la ruta actual, o null en Inicio/Ajustes. */
export function findWorkspace(currentPath: string): WorkspaceMeta | null {
  return WORKSPACES.find((ws) => ws.items.some((item) => isActivePath(currentPath, item.href, item.exact))) ?? null;
}

// Fuera de un espacio (Inicio, Ajustes), el sidebar y la acción principal de
// la cabecera (ver AppShell.tsx) muestran Nóminas por defecto — es el
// producto principal de la app.
export const DEFAULT_WORKSPACE: WorkspaceMeta = WORKSPACES.find((ws) => ws.key === "nominas") ?? WORKSPACES[0];

export function getActiveWorkspace(currentPath: string): WorkspaceMeta {
  return findWorkspace(currentPath) ?? DEFAULT_WORKSPACE;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function getBreadcrumbTrail(currentPath: string): Crumb[] {
  if (isActivePath(currentPath, HOME_ITEM.href, true)) return [{ label: HOME_ITEM.label }];
  if (isActivePath(currentPath, SETTINGS_ITEM.href)) {
    return [{ label: HOME_ITEM.label, href: HOME_ITEM.href }, { label: SETTINGS_ITEM.label }];
  }
  for (const ws of WORKSPACES) {
    const item = ws.items.find((i) => isActivePath(currentPath, i.href, i.exact));
    if (!item) continue;
    if (item.href === ws.href) return [{ label: HOME_ITEM.label, href: HOME_ITEM.href }, { label: ws.label }];
    return [
      { label: HOME_ITEM.label, href: HOME_ITEM.href },
      { label: ws.label, href: ws.href },
      { label: item.label },
    ];
  }
  return [{ label: HOME_ITEM.label, href: HOME_ITEM.href }];
}
