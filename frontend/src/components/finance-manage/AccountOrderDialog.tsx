import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { reorderAccounts, type Account } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { darkBoost } from "../../lib/color";
import { moveItem } from "../../lib/reorder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Todas las cuentas, en el orden actual. Se ordenan las activas; las archivadas quedan detrás. */
  accounts: Account[];
}

// Ordenar las cuentas: arrastrando (escritorio) o con las flechas (móvil y
// teclado). El orden se guarda en la cuenta y se usa en toda la app.
export function AccountOrderDialog({ open, onClose, accounts }: Props) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Account[]>([]);
  // El índice arrastrado va en una ref: los dragover llegan muy seguidos y un
  // estado podría leerse de un render anterior (la fila "saltaría" mal).
  const dragRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (open) setItems(accounts.filter((a) => !a.archived));
  }, [open, accounts]);

  const save = useMutation({
    mutationFn: () => reorderAccounts([...items, ...accounts.filter((a) => a.archived)].map((a) => a.id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Orden de las cuentas guardado");
      onClose();
    },
    onError: () => toast.error("No se pudo guardar el orden. Vuelve a intentarlo."),
  });

  const move = (from: number, to: number) => setItems((list) => moveItem(list, from, to));
  const changed = items.some((a, i) => a.id !== accounts.filter((x) => !x.archived)[i]?.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
          <DialogTitle>Ordenar cuentas</DialogTitle>
          <DialogDescription>Muévelas con las flechas o, en el ordenador, arrastrándolas. El orden se usa en toda la app.</DialogDescription>
        </DialogHeader>

        <ol className="max-h-[60vh] space-y-1.5 overflow-y-auto px-3 py-3" aria-label="Cuentas en orden">
          {items.map((account, index) => (
            <li
              key={account.id}
              draggable
              onDragStart={(e) => {
                dragRef.current = index;
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const from = dragRef.current;
                if (from !== null && from !== index) {
                  move(from, index);
                  dragRef.current = index;
                  setDragIndex(index);
                }
              }}
              onDragEnd={() => { dragRef.current = null; setDragIndex(null); }}
              onDrop={(e) => e.preventDefault()}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-2 transition-colors",
                dragIndex === index && "border-primary/40 bg-primary/5 opacity-70",
              )}
            >
              <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted-foreground/60 md:block" aria-hidden="true" />
              <span className={cn("size-2.5 shrink-0 rounded-full", darkBoost(account.color))} style={{ backgroundColor: account.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{account.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(account.balance)}</span>
              <div className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Subir ${account.name}`}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(index, index + 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Bajar ${account.name}`}
                >
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={!changed || save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar orden"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
