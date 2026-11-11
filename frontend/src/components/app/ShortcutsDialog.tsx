import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

const GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: "En toda la app",
    items: [
      { keys: ["N"], label: "Nueva transacción" },
      { keys: [MOD, "K"], label: "Buscar en toda la app" },
      { keys: ["/"], label: "Ir al buscador de la página" },
      { keys: ["?"], label: "Ver esta lista" },
    ],
  },
  {
    title: "En la lista de movimientos",
    items: [
      { keys: ["↑", "↓"], label: "Moverse entre movimientos (también J y K)" },
      { keys: ["Intro"], label: "Editar el movimiento (también E)" },
      { keys: ["C"], label: "Marcar como liquidado o pendiente" },
    ],
  },
  {
    title: "En el formulario de movimiento",
    items: [{ keys: [MOD, "Intro"], label: "Guardar y apuntar otro" }],
  },
];

/** Lista de atajos de teclado (se abre con «?»). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>Funcionan cuando no estás escribiendo en un campo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{g.title}</h3>
              <dl className="space-y-1.5">
                {g.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-foreground">{item.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {item.keys.map((k) => (
                        <kbd key={k} className="min-w-6 rounded-md border border-border bg-muted px-1.5 py-0.5 text-center font-sans text-xs text-muted-foreground">{k}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
