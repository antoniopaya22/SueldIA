import * as React from "react";
import { CornerDownLeft, FileText, Monitor, Moon, Receipt, Search, Sun, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";
import { HOME_ITEM, SETTINGS_ITEM, WORKSPACES } from "./navigation";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { getPayslips, getTransactions } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { openNewTransaction } from "@/lib/new-transaction";

interface CommandEntry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const go = (href: string) => () => {
  window.location.href = href;
};

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function payslipPeriodLabel(month: number | null, year: number | null): string {
  if (!month || !year) return "Sin periodo";
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

// Paleta ligera sobre el Dialog de Base UI (sin cmdk, que arrastra Radix).
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { setPreference } = useTheme();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [searchEntries, setSearchEntries] = React.useState<CommandEntry[]>([]);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Búsqueda real de nóminas y transacciones (con retraso, ⌘K es su propia
  // isla sin QueryClientProvider — mismo patrón de fetch simple que la
  // campana de notificaciones en AppShell.tsx). A partir de 2 caracteres.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchEntries([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all([
        getPayslips({ search: q, limit: 5 }).catch(() => ({ data: [] })),
        getTransactions({ search: q, limit: 5 }).catch(() => ({ data: [] })),
      ]).then(([payslips, transactions]) => {
        if (cancelled) return;
        const payslipEntries: CommandEntry[] = payslips.data.map((p) => ({
          id: `payslip:${p.id}`,
          group: "Nóminas",
          label: p.company ?? p.fileName,
          hint: payslipPeriodLabel(p.periodMonth, p.periodYear),
          icon: FileText,
          run: go(`/app/payslips?perfil=${p.profileId}&nomina=${p.id}`),
        }));
        const txEntries: CommandEntry[] = transactions.data.map((t) => ({
          id: `tx:${t.id}`,
          group: "Transacciones",
          label: t.payee || t.memo || "Sin descripción",
          hint: `${formatCurrency(t.amount)} · ${t.date}`,
          icon: Receipt,
          run: go(`/app/transactions?buscar=${encodeURIComponent(t.payee || q)}`),
        }));
        setSearchEntries([...payslipEntries, ...txEntries]);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const entries = React.useMemo<CommandEntry[]>(() => {
    const nav: CommandEntry[] = [
      { id: HOME_ITEM.href, group: "Ir a", label: HOME_ITEM.label, icon: HOME_ITEM.icon, keywords: HOME_ITEM.keywords, run: go(HOME_ITEM.href) },
      ...WORKSPACES.flatMap((ws) =>
        ws.items.map((item) => ({
          id: item.href,
          group: "Ir a",
          label: item.label,
          hint: ws.label,
          icon: item.icon,
          keywords: `${ws.label} ${item.keywords ?? ""}`,
          run: go(item.href),
        })),
      ),
      { id: SETTINGS_ITEM.href, group: "Ir a", label: SETTINGS_ITEM.label, icon: SETTINGS_ITEM.icon, keywords: SETTINGS_ITEM.keywords, run: go(SETTINGS_ITEM.href) },
    ];
    const actions: CommandEntry[] = WORKSPACES.map((ws) => ({
      id: `action:${ws.key}`,
      group: "Acciones",
      label: ws.primaryAction.label,
      hint: ws.label,
      icon: ws.primaryAction.icon,
      run: ws.primaryAction.opens === "new-transaction" ? () => openNewTransaction() : go(ws.primaryAction.href),
    }));
    const theme = (value: ThemePreference, label: string, icon: LucideIcon): CommandEntry => ({
      id: `theme:${value}`,
      group: "Tema",
      label,
      icon,
      keywords: "tema apariencia modo",
      run: () => setPreference(value),
    });
    return [...actions, ...nav, theme("light", "Tema claro", Sun), theme("dark", "Tema oscuro", Moon), theme("system", "Tema del sistema", Monitor)];
  }, [setPreference]);

  const filtered = React.useMemo(() => {
    const q = normalize(query.trim());
    const local = q ? entries.filter((e) => normalize(`${e.label} ${e.hint ?? ""} ${e.keywords ?? ""}`).includes(q)) : entries;
    return q ? [...local, ...searchEntries] : local;
  }, [entries, query, searchEntries]);

  React.useEffect(() => setActiveIndex(0), [query, searchEntries]);
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchEntries([]);
    }
  }, [open]);

  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runEntry = (entry: CommandEntry | undefined) => {
    if (!entry) return;
    onOpenChange(false);
    entry.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runEntry(filtered[activeIndex]);
    }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Buscar en SueldIA</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Busca una página o acción…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={filtered[activeIndex] ? `cmd-${activeIndex}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">Esc</kbd>
        </div>
        <div ref={listRef} id="command-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Sin resultados para “{query}”</p>}
          {filtered.map((entry, index) => {
            const header = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            const Icon = entry.icon;
            const active = index === activeIndex;
            return (
              <React.Fragment key={entry.id}>
                {header && <p className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium text-muted-foreground">{header}</p>}
                <div
                  id={`cmd-${index}`}
                  role="option"
                  aria-selected={active}
                  data-index={index}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => runEntry(entry)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                    active ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", active ? "text-primary-600 dark:text-primary" : "text-muted-foreground")} aria-hidden="true" />
                  <span className="flex-1 truncate">{entry.label}</span>
                  {entry.hint && <span className="text-xs text-muted-foreground">{entry.hint}</span>}
                  {active && <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
