import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Gift } from "lucide-react";
import { cn } from "cn";
import { adaptiveColor } from "../../lib/color";

export const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MONTHS_FULL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function formatPeriod(month: number | null, year: number | null, long = false): string {
  if (!month || !year) return "Sin periodo";
  return long ? `${MONTHS_FULL[month - 1]} ${year}` : `${MONTHS_SHORT[month - 1]} ${year}`;
}

export type ParsingStatus = "parsed" | "review" | "pending" | "error";

export const STATUS_META: Record<ParsingStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  parsed: {
    label: "Procesada",
    icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  review: {
    label: "Revisar",
    icon: AlertTriangle,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  pending: {
    label: "Procesando",
    icon: Loader2,
    className: "bg-muted text-muted-foreground",
  },
  error: {
    label: "Error",
    icon: CircleDashed,
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

export function statusMeta(status: string) {
  return STATUS_META[status as ParsingStatus] ?? STATUS_META.error;
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium", meta.className, className)}>
      <Icon className={cn("size-3.5", status === "pending" && "animate-spin")} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function ExtraBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] font-medium text-muted-foreground", className)}>
      <Gift className="size-3" aria-hidden="true" />
      Extra
    </span>
  );
}

export function adaptiveProfileColor(hex: string | undefined): string {
  return adaptiveColor(hex);
}

/** Avatar redondo con el color del perfil (el color lo elige el usuario). */
export function ProfileDot({ color: rawColor, name, size = "md" }: { color: string; name: string; size?: "sm" | "md" | "lg" }) {
  const color = adaptiveProfileColor(rawColor);
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-card",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-12 text-sm",
      )}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/** Colores que se proponen al crear una etiqueta (por orden). */
export const TAG_COLORS = ["#2a8558", "#f59e0b", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];
