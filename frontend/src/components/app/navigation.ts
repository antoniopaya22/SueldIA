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
  /** Etiqueta corta para la barra inferior en móvil (si la normal no cabe). */
  shortLabel?: string;
  /** Los elementos con sección van agrupados bajo su etiqueta (p. ej. "Configurar"); sin sección, bajo el nombre del espacio. */
  section?: string;
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
  /**
   * Pestañas de la barra inferior en móvil (hrefs de `items`): dos a la
   * izquierda y una a la derecha de la acción principal; el resto, en "Más".
   */
  mobileTabs: [string, string, string];
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
    mobileTabs: ["/app/finance", "/app/transactions", "/app/budget"],
    items: [
      { href: "/app/finance", label: "Resumen", icon: Wallet, exact: true, keywords: "finanzas resumen dashboard" },
      { href: "/app/transactions", label: "Transacciones", shortLabel: "Movimientos", icon: Receipt, keywords: "movimientos gastos ingresos apuntar" },
      { href: "/app/budget", label: "Presupuesto", icon: PiggyBank, keywords: "presupuesto categorías asignar objetivos" },
      { href: "/app/finance/report", label: "Informe del mes", icon: FileChartColumn, keywords: "informe resumen mes comparar media inusual" },
      { href: "/app/finance/analytics", label: "Analítica", icon: PieChart, keywords: "finanzas gráficos gastos" },
      { href: "/app/accounts", label: "Cuentas", icon: Landmark, keywords: "banco tarjeta saldo patrimonio" },
      { href: "/app/categories", label: "Categorías", icon: Tags, section: "Configurar", keywords: "grupos reglas automáticas" },
      { href: "/app/import", label: "Importar", icon: ArrowDownToLine, section: "Configurar", keywords: "ynab csv" },
    ],
  },
  {
    key: "nominas",
    label: "Nóminas",
    description: "Salarios, retenciones y análisis",
    icon: FileText,
    href: "/app/payroll",
    primaryAction: { label: "Subir nómina", href: "/app/upload", icon: Upload },
    mobileTabs: ["/app/payroll", "/app/payslips", "/app/analytics"],
    items: [
      { href: "/app/payroll", label: "Dashboard", shortLabel: "Resumen", icon: ChartColumn, keywords: "nóminas resumen salario" },
      { href: "/app/upload", label: "Subir nóminas", icon: Upload, keywords: "pdf" },
      { href: "/app/payslips", label: "Mis nóminas", shortLabel: "Nóminas", icon: FileText, keywords: "listado pdf" },
      { href: "/app/analytics", label: "Analítica", icon: PieChart, keywords: "nóminas tendencias predicción" },
      { href: "/app/profiles", label: "Perfiles", icon: Users, keywords: "personas" },
      { href: "/app/alerts", label: "Alertas", icon: Bell, keywords: "notificaciones avisos reglas" },
    ],
  },
];

/** Pestañas de la barra inferior de un espacio, como elementos de navegación. */
export function getMobileTabs(ws: WorkspaceMeta): NavItem[] {
  return ws.mobileTabs
    .map((href) => ws.items.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item));
}

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

/** Agrupa los elementos del menú por sección conservando el orden (`label: null` = la etiqueta del espacio). */
export function groupNavItems(items: NavItem[]): { label: string | null; items: NavItem[] }[] {
  const groups: { label: string | null; items: NavItem[] }[] = [];
  for (const item of items) {
    const label = item.section ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
