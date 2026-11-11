import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Merge, Search, Store } from "lucide-react";
import { toast } from "sonner";
import { getPayeeSummary, renamePayees, type PayeeSummary } from "../lib/api";
import { invalidateFinance } from "../lib/finance-cache";
import { formatCurrency, plural } from "../lib/format";
import { transactionsHref } from "../lib/transaction-filters";
import { normalizeSearch } from "../lib/text";
import { Providers } from "./Providers";
import { ListCardSkeleton, PageHeader, PageHeaderSkeleton, SectionCard } from "./app";
import { EmptyState } from "./ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Beneficiarios: renombrar y fusionar variantes («MERCADONA 1234»,
 * «Mercadona», «mercadona s.a.»). Sin esto, reglas y rankings se fragmentaban.
 */
function PayeesView() {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["payee-summary"], queryFn: getPayeeSummary });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    return q ? data.filter((p) => normalizeSearch(p.payee).includes(q)) : data;
  }, [data, query]);

  const openRename = (payees: string[]) => {
    setSelected(new Set(payees));
    // Propuesta: el nombre más usado de los elegidos.
    const top = data.filter((p) => payees.includes(p.payee)).sort((a, b) => b.count - a.count)[0];
    setNewName(top?.payee ?? "");
    setRenameOpen(true);
  };

  const renameMut = useMutation({
    mutationFn: () => renamePayees([...selected], newName.trim()),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["payee-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payee-suggestions"] });
      invalidateFinance(queryClient);
      toast.success(`${plural(res.updated, "movimiento actualizado", "movimientos actualizados")}`);
      setSelected(new Set());
      setRenameOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (payee: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(payee)) next.delete(payee);
      else next.add(payee);
      return next;
    });

  if (isLoading) return <><PageHeaderSkeleton /><ListCardSkeleton rows={8} /></>;
  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="No se pudieron cargar los beneficiarios" description="Vuelve a intentarlo en unos segundos.">
        <Button onClick={() => refetch()}>Reintentar</Button>
      </EmptyState>
    );
  }

  return (
    <div>
      <PageHeader
        title="Beneficiarios"
        description="Junta las variantes de un mismo comercio para que reglas, rankings y búsquedas cuadren."
        actions={
          selected.size > 1 ? (
            <Button onClick={() => openRename([...selected])} className="gap-1.5">
              <Merge className="size-4" /> Fusionar {selected.size}
            </Button>
          ) : undefined
        }
      />

      {data.length === 0 ? (
        <EmptyState icon={Store} title="Aún no hay beneficiarios" description="Aparecerán aquí cuando apuntes o importes movimientos." />
      ) : (
        <SectionCard flush>
          <div className="border-b border-border p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar beneficiario" aria-label="Buscar beneficiario" data-page-search className="pl-8" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Marca varios para fusionarlos en uno, o pulsa un nombre para renombrarlo.</p>
          </div>
          <ul className="divide-y divide-border">
            {filtered.slice(0, 300).map((p: PayeeSummary) => (
              <li key={p.payee} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Checkbox checked={selected.has(p.payee)} onCheckedChange={() => toggle(p.payee)} aria-label={`Seleccionar ${p.payee}`} />
                <button type="button" onClick={() => openRename([p.payee])} className="min-w-0 flex-1 truncate text-left font-medium text-foreground hover:underline" title="Renombrar">
                  {p.payee}
                </button>
                <span className="hidden text-xs text-muted-foreground sm:inline">{plural(p.count, "movimiento", "movimientos")}</span>
                <span className="w-28 text-right tabular-nums text-foreground">{p.expense > 0 ? `−${formatCurrency(p.expense)}` : `+${formatCurrency(p.income)}`}</span>
                <a href={transactionsHref({ search: p.payee })} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Ver</a>
              </li>
            ))}
          </ul>
          {filtered.length > 300 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Mostrando 300 de {filtered.length}. Usa el buscador.</p>}
        </SectionCard>
      )}

      <Dialog open={renameOpen} onOpenChange={(o) => { if (!o) setRenameOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) renameMut.mutate(); }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{selected.size > 1 ? `Fusionar ${selected.size} beneficiarios` : "Renombrar beneficiario"}</DialogTitle>
              <DialogDescription>
                {selected.size > 1 ? `${[...selected].slice(0, 4).join(", ")}${selected.size > 4 ? "…" : ""} pasarán a llamarse igual.` : "Se cambia en todos sus movimientos y recurrentes."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="payee-name">Nombre</Label>
              <Input id="payee-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={!newName.trim() || renameMut.isPending}>{selected.size > 1 ? "Fusionar" : "Renombrar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayeesPage() {
  return (
    <Providers>
      <PayeesView />
    </Providers>
  );
}
