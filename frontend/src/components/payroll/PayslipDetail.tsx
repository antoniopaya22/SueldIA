import { useMemo, useState } from "react";
import { useLeaveGuard } from "../../hooks/use-leave-guard";
import { deferWithUndo } from "../../lib/undo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Building2, ChevronDown, FileText, Gift, Link2, Loader2, MoreHorizontal,
  NotebookPen, Pencil, Plus, RefreshCw, Save, Search, Tag as TagIcon, Trash2, Unlink, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignTag, createNote, createTag, deleteNote, getNotes, getPayslipTags, getTags, removeTag,
  getPayslipLinkSuggestions, getTransactions, linkPayslipTransaction,
  updatePayslipConcepts, updatePayslipType,
  type Payslip, type PayslipConcept, type PayslipLinkCandidate,
} from "../../lib/api";
import { formatCurrency, formatPct } from "../../lib/format";
import { DecimalInput, PageHeader, SectionCard, StatCard, StatGrid } from "../app";
import { ConfirmModal } from "../ui/ConfirmModal";
import { StatusBadge, ExtraBadge, MONTHS_FULL, formatPeriod } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";

// El backend devuelve la fila completa (incluido el texto extraído), aunque
// el tipo compartido no lo declare.
export type PayslipWithConcepts = Payslip & { concepts: PayslipConcept[]; rawText?: string | null };

const TAG_COLORS = ["#2a8558", "#f59e0b", "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6"];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Conceptos ──────────────────────────────────────────────────
function ConceptTable({
  title, tone, concepts, allConcepts, editing, onChange, onRemove, onAdd, invalidAmounts,
}: {
  title: string;
  tone: "devengo" | "deduccion";
  concepts: PayslipConcept[];
  allConcepts: PayslipConcept[];
  editing: boolean;
  onChange: (index: number, field: "name" | "amount", value: string | number) => void;
  invalidAmounts?: boolean;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const total = concepts.reduce((s, c) => s + (c.isPercentage || !Number.isFinite(c.amount) ? 0 : c.amount), 0);
  const sorted = editing ? concepts : [...concepts].sort((a, b) => b.amount - a.amount);
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", tone === "devengo" ? "bg-primary-500 dark:bg-primary" : "bg-red-500")} />
          {title}
          <span className="font-normal text-muted-foreground">· {concepts.length}</span>
        </span>
      }
      flush
      footer={
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Total {tone === "devengo" ? "devengado" : "deducciones"}</span>
          <span className={cn("font-semibold tabular-nums", tone === "devengo" ? "text-foreground" : "text-red-600 dark:text-red-400")}>
            {tone === "deduccion" && total > 0 ? "−" : ""}{formatCurrency(total)}
          </span>
        </div>
      }
    >
      {sorted.length === 0 && !editing ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          {tone === "devengo" ? "No se detectaron devengos." : "No se detectaron deducciones."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((c) => {
            const realIndex = allConcepts.indexOf(c);
            return (
              <li key={realIndex} className="flex items-center gap-3 px-5 py-2.5">
                {editing ? (
                  <>
                    <Input
                      value={c.name}
                      onChange={(e) => onChange(realIndex, "name", e.target.value)}
                      placeholder="Concepto"
                      aria-label="Nombre del concepto"
                      className="h-8 flex-1"
                    />
                    <DecimalInput
                      value={c.amount}
                      // Vacío o no numérico → NaN: el formulario lo marca al guardar.
                      onValueChange={(v) => onChange(realIndex, "amount", v ?? Number.NaN)}
                      aria-label={`Importe de ${c.name || "concepto"}`}
                      aria-invalid={invalidAmounts && !Number.isFinite(c.amount) ? true : undefined}
                      className="h-8 w-24 shrink-0 text-right tabular-nums"
                    />
                    <Button variant="ghost" size="icon-sm" onClick={() => onRemove(realIndex)} aria-label="Quitar concepto" className="text-muted-foreground hover:text-destructive">
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {c.isPercentage ? formatPct(c.amount) : `${tone === "deduccion" ? "−" : ""}${formatCurrency(c.amount)}`}
                    </span>
                  </>
                )}
              </li>
            );
          })}
          {editing && (
            <li className="px-5 py-2.5">
              <Button variant="ghost" size="sm" onClick={onAdd} className="gap-1.5 text-primary-700 hover:text-primary-700 dark:text-primary">
                <Plus className="size-3.5" /> Añadir {tone === "devengo" ? "devengo" : "deducción"}
              </Button>
            </li>
          )}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── Reparto del bruto ──────────────────────────────────────────
function BreakdownCard({ payslip }: { payslip: PayslipWithConcepts }) {
  const gross = payslip.grossSalary ?? 0;
  const net = payslip.netSalary ?? 0;
  const irpf = payslip.concepts
    .filter((c) => c.category === "deduccion" && !c.isPercentage && c.name.toLowerCase().includes("irpf"))
    .reduce((s, c) => s + c.amount, 0);
  const other = Math.max(gross - net - irpf, 0);
  const segments = [
    { label: "Neto", value: net, className: "bg-primary-500 dark:bg-primary" },
    { label: "IRPF", value: irpf, className: "bg-amber-400" },
    { label: "Seg. Social y otros", value: other, className: "bg-brand-navy/70 dark:bg-slate-500" },
  ];
  return (
    <SectionCard title="Del bruto al neto" description="Cómo se reparte lo que cobras">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Reparto del bruto">
        {segments.map((s) => (
          <div key={s.label} className={cn("h-full", s.className)} style={{ width: `${gross ? (s.value / gross) * 100 : 0}%` }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", s.className)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">{formatCurrency(s.value)}</span>
            <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{gross ? formatPct((s.value / gross) * 100) : "—"}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ─── Etiquetas ──────────────────────────────────────────────────
function TagsCard({ payslipId }: { payslipId: number }) {
  const queryClient = useQueryClient();
  const { data: assigned = [] } = useQuery({ queryKey: ["payslip-tags", payslipId], queryFn: () => getPayslipTags(payslipId) });
  const { data: allTags = [] } = useQuery({ queryKey: ["tags"], queryFn: getTags });
  const [newTag, setNewTag] = useState("");
  const [open, setOpen] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payslip-tags", payslipId] });
  const assignMut = useMutation({
    mutationFn: (tagId: number) => assignTag(payslipId, tagId),
    onSuccess: refresh,
    onError: () => toast.error("No se pudo añadir la etiqueta"),
  });
  const removeMut = useMutation({
    mutationFn: (tagId: number) => removeTag(payslipId, tagId),
    onSuccess: refresh,
    onError: () => toast.error("No se pudo quitar la etiqueta"),
  });
  const createMut = useMutation({
    mutationFn: (name: string) => createTag(name, TAG_COLORS[allTags.length % TAG_COLORS.length]),
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      setNewTag("");
      assignMut.mutate(tag.id);
    },
    onError: () => toast.error("No se pudo crear la etiqueta"),
  });

  const available = allTags.filter((t) => !assigned.some((a) => a.id === t.id));

  return (
    <SectionCard
      title="Etiquetas"
      icon={TagIcon}
      action={
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" />}>
            <Plus className="size-3.5" /> Añadir
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            {available.length > 0 && (
              <div className="mb-2 flex flex-col">
                {available.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { assignMut.mutate(t.id); setOpen(false); }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); if (newTag.trim()) createMut.mutate(newTag.trim()); }}
              className={cn("flex gap-1.5", available.length > 0 && "border-t border-border pt-2")}
            >
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" aria-label="Nueva etiqueta" className="h-8" maxLength={30} />
              <Button type="submit" size="sm" disabled={!newTag.trim() || createMut.isPending}>Crear</Button>
            </form>
          </PopoverContent>
        </Popover>
      }
    >
      {assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin etiquetas. Úsalas para marcar nóminas revisadas, con atrasos…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {assigned.map((t) => (
            <span key={t.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card pr-1 pl-2.5 text-xs font-medium text-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
              <button
                type="button"
                onClick={() => removeMut.mutate(t.id)}
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Quitar etiqueta ${t.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Notas ──────────────────────────────────────────────────────
function NotesCard({ payslipId }: { payslipId: number }) {
  const queryClient = useQueryClient();
  const { data: notes = [] } = useQuery({ queryKey: ["notes", payslipId], queryFn: () => getNotes(payslipId) });
  const [content, setContent] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notes", payslipId] });
  const addMut = useMutation({
    mutationFn: () => createNote(payslipId, content.trim()),
    onSuccess: () => { setContent(""); refresh(); },
    onError: () => toast.error("No se pudo guardar la nota"),
  });
  // Borrar con «Deshacer»: desaparece al momento y se borra a los pocos segundos.
  const removeNote = (id: number) => {
    queryClient.setQueryData<typeof notes>(["notes", payslipId], (old) => old?.filter((n) => n.id !== id));
    deferWithUndo({
      message: "Nota borrada",
      commit: () => deleteNote(id),
      onUndo: refresh,
      onCommitted: refresh,
      onError: () => { toast.error("No se pudo borrar la nota"); refresh(); },
    });
  };

  return (
    <SectionCard title="Notas" icon={NotebookPen}>
      {notes.length > 0 && (
        <ul className="mb-4 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="group relative rounded-lg border border-border bg-muted/30 p-3 pr-9">
              <p className="whitespace-pre-wrap text-sm text-foreground">{n.content}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
              </p>
              <button
                type="button"
                onClick={() => removeNote(n.id)}
                // Visible siempre en pantallas táctiles (sin hover no se veía).
                className="absolute top-1.5 right-1.5 flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                aria-label="Borrar nota"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (content.trim()) addMut.mutate(); }} className="space-y-2">
        <Label htmlFor={`note-${payslipId}`} className="sr-only">Nueva nota</Label>
        <Textarea
          id={`note-${payslipId}`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Apunta algo sobre esta nómina…"
          rows={2}
          maxLength={2000}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="outline" disabled={!content.trim() || addMut.isPending}>Guardar nota</Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ─── Avisos informativos (validación de importes/SMI) ────────────
function WarningsBanner({ warnings }: { warnings: { code: string; message: string }[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {warnings.map((w) => (
        <div key={w.code} className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{w.message}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Vincular con un ingreso de Finanzas ─────────────────────────
function LinkIncomeCard({
  payslipId,
  linkedTransaction,
}: {
  payslipId: number;
  linkedTransaction: PayslipLinkCandidate | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PayslipLinkCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  const { data: suggestions = [], isLoading: loadingSuggestions } = useQuery({
    queryKey: ["payslip-link-suggestions", payslipId],
    queryFn: () => getPayslipLinkSuggestions(payslipId).then((r) => r.data),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payslip", payslipId] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
  };

  const linkMut = useMutation({
    mutationFn: (transactionId: number) => linkPayslipTransaction(payslipId, transactionId),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast.success("Nómina vinculada con el ingreso");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo vincular"),
  });

  const unlinkMut = useMutation({
    mutationFn: () => linkPayslipTransaction(payslipId, null),
    onSuccess: () => {
      invalidate();
      toast.success("Vínculo eliminado");
    },
    onError: () => toast.error("No se pudo quitar el vínculo"),
  });

  const runSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await getTransactions({ type: "income", search: q.trim(), limit: 10 });
      setSearchResults(res.data);
    } finally {
      setSearching(false);
    }
  };

  const candidateRow = (t: PayslipLinkCandidate) => (
    <li key={t.id}>
      <button
        type="button"
        onClick={() => linkMut.mutate(t.id)}
        disabled={linkMut.isPending}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{t.payee || t.accountName}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatCurrency(t.amount)} · {new Date(t.date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
        </span>
      </button>
    </li>
  );

  return (
    <SectionCard title="Ingreso vinculado" icon={Link2} description="Enlaza esta nómina con su movimiento de ingreso en Finanzas.">
      {linkedTransaction ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{linkedTransaction.payee || linkedTransaction.accountName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatCurrency(linkedTransaction.amount)} · {linkedTransaction.accountName} ·{" "}
              {new Date(linkedTransaction.date).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => unlinkMut.mutate()}
            disabled={unlinkMut.isPending}
            aria-label="Quitar vínculo"
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Unlink className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Aún no has vinculado el ingreso de esta nómina.</p>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setOpen(true)}>
            <Link2 className="size-4" /> Vincular ingreso
          </Button>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular con un ingreso</DialogTitle>
            <DialogDescription>Elige a mano la transacción de Finanzas que corresponde a esta nómina.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Sugeridas</p>
              {loadingSuggestions ? (
                <p className="text-sm text-muted-foreground">Buscando candidatas…</p>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin sugerencias — busca manualmente abajo.</p>
              ) : (
                <ul className="space-y-1.5">{suggestions.map(candidateRow)}</ul>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <Label htmlFor="link-search" className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Search className="size-3.5" /> Buscar otro ingreso
              </Label>
              <Input id="link-search" value={query} onChange={(e) => runSearch(e.target.value)} placeholder="Beneficiario…" />
              {searching && <p className="mt-2 text-xs text-muted-foreground">Buscando…</p>}
              {!searching && query.trim().length >= 2 && (
                <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin resultados.</p>
                  ) : (
                    searchResults.map(candidateRow)
                  )}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

// ─── Detalle ────────────────────────────────────────────────────
export function PayslipDetail({
  payslip, profileName, onBack, onDelete, onReprocess, isReprocessing, onEditingChange,
}: {
  payslip: PayslipWithConcepts;
  profileName?: string;
  onBack: () => void;
  onDelete: () => void;
  onReprocess: () => void;
  isReprocessing: boolean;
  /** Avisa al padre de que hay una edición en curso (para no refrescar los datos debajo). */
  onEditingChange?: (editing: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [concepts, setConcepts] = useState(payslip.concepts);
  // Lo que no se sabe se queda vacío (null): antes se rellenaba con 0 € y con
  // el mes actual, y al guardar esos valores inventados entraban en medias,
  // totales y series como si fueran reales.
  const initialMeta = () => ({
    grossSalary: payslip.grossSalary,
    netSalary: payslip.netSalary,
    periodMonth: payslip.periodMonth,
    periodYear: payslip.periodYear,
    company: payslip.company ?? "",
  });
  const [meta, setMeta] = useState<{
    grossSalary: number | null;
    netSalary: number | null;
    periodMonth: number | null;
    periodYear: number | null;
    company: string;
  }>(initialMeta);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmReprocess, setConfirmReprocess] = useState(false);

  // Un clic en el menú con una edición a medias la perdía sin avisar.
  useLeaveGuard(editing, "Tienes cambios sin guardar en esta nómina. ¿Salir sin guardarlos?");

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (meta.periodMonth == null) e.periodMonth = "Elige el mes";
    if (meta.periodYear == null || !Number.isInteger(meta.periodYear) || meta.periodYear < 1990 || meta.periodYear > 2100)
      e.periodYear = "Año entre 1990 y 2100";
    if (meta.grossSalary != null && !Number.isFinite(meta.grossSalary)) e.grossSalary = "Importe no válido";
    if (meta.netSalary != null && !Number.isFinite(meta.netSalary)) e.netSalary = "Importe no válido";
    if (concepts.some((c) => c.name.trim() && !Number.isFinite(c.amount))) e.concepts = "Hay conceptos sin un importe válido";
    return e;
  };

  const save = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Revisa los campos marcados");
      return;
    }
    saveMut.mutate();
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["payslip", payslip.id] });
    queryClient.invalidateQueries({ queryKey: ["payslips"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      updatePayslipConcepts(payslip.id, {
        concepts: concepts
          .filter((c) => c.name.trim())
          .map((c) => ({ category: c.category, name: c.name.trim(), amount: c.amount, isPercentage: c.isPercentage })),
        grossSalary: meta.grossSalary,
        netSalary: meta.netSalary,
        periodMonth: meta.periodMonth ?? undefined,
        periodYear: meta.periodYear ?? undefined,
        company: meta.company.trim() || null,
      }),
    onSuccess: () => {
      setEditing(false);
      onEditingChange?.(false);
      invalidate();
      toast.success("Nómina actualizada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudieron guardar los cambios"),
  });

  const typeMut = useMutation({
    mutationFn: (type: "ordinal" | "extra") => updatePayslipType(payslip.id, type),
    onSuccess: (_d, type) => {
      invalidate();
      toast.success(type === "extra" ? "Marcada como paga extra" : "Marcada como nómina mensual");
    },
    onError: () => toast.error("No se pudo cambiar el tipo"),
  });

  const shownConcepts = editing ? concepts : payslip.concepts;
  const devengos = shownConcepts.filter((c) => c.category === "devengo");
  const deducciones = shownConcepts.filter((c) => c.category === "deduccion");
  const gross = payslip.grossSalary ?? 0;
  const net = payslip.netSalary ?? 0;
  const irpf = useMemo(
    () => payslip.concepts.filter((c) => c.category === "deduccion" && !c.isPercentage && c.name.toLowerCase().includes("irpf")).reduce((s, c) => s + c.amount, 0),
    [payslip.concepts],
  );

  const updateConcept = (index: number, field: "name" | "amount", value: string | number) =>
    setConcepts((cs) => cs.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  const addConcept = (category: "devengo" | "deduccion") =>
    setConcepts((cs) => [...cs, { id: 0, payslipId: payslip.id, category, name: "", amount: 0, isPercentage: false }]);
  const removeConcept = (index: number) => setConcepts((cs) => cs.filter((_, i) => i !== index));

  // La edición parte siempre de los datos actuales del servidor; fuera de
  // edición se muestra directamente `payslip`, así un refresco (tras guardar o
  // reprocesar) se ve sin tener que remontar el componente.
  const startEdit = () => {
    setConcepts(payslip.concepts);
    setMeta(initialMeta());
    setErrors({});
    setEditing(true);
    onEditingChange?.(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    onEditingChange?.(false);
    setErrors({});
    setConcepts(payslip.concepts);
    setMeta(initialMeta());
  };

  const period = payslip.periodMonth && payslip.periodYear
    ? capitalize(formatPeriod(payslip.periodMonth, payslip.periodYear, true))
    : "Nómina sin periodo";

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Mis nóminas
      </button>

      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {payslip.company && <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" />{payslip.company}</span>}
            {profileName && <span>· {profileName}</span>}
          </span>
        }
        title={period}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={payslip.parsingStatus} />
            {payslip.payslipType === "extra" && <ExtraBadge className="h-6" />}
          </span>
        }
        actions={
          editing ? (
            <>
              <Button variant="outline" onClick={cancelEdit} disabled={saveMut.isPending}>Cancelar</Button>
              <Button onClick={save} disabled={saveMut.isPending} className="gap-1.5">
                {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Guardar cambios
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startEdit} className="gap-1.5">
                <Pencil className="size-4" /> Editar
              </Button>
              <Button variant="outline" onClick={() => setConfirmReprocess(true)} disabled={isReprocessing} className="gap-1.5">
                <RefreshCw className={cn("size-4", isReprocessing && "animate-spin")} />
                {isReprocessing ? "Reprocesando…" : "Reprocesar"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Más acciones" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem
                    onClick={() => typeMut.mutate(payslip.payslipType === "extra" ? "ordinal" : "extra")}
                    disabled={typeMut.isPending}
                    className="gap-2"
                  >
                    <Gift className="size-4" />
                    {payslip.payslipType === "extra" ? "Marcar como mensual" : "Marcar como paga extra"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} variant="destructive" className="gap-2">
                    <Trash2 className="size-4" /> Eliminar nómina
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />

      {!editing && <WarningsBanner warnings={payslip.warnings ?? []} />}

      {editing ? (
        <SectionCard title="Datos generales" description="Corrige lo que no se haya leído bien del PDF." className="mb-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="col-span-2 space-y-1.5 lg:col-span-1">
              <Label htmlFor="edit-company">Empresa</Label>
              <Input id="edit-company" value={meta.company} onChange={(e) => setMeta((m) => ({ ...m, company: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-month">Mes</Label>
              <Select value={meta.periodMonth == null ? "" : String(meta.periodMonth)} onValueChange={(v) => v && setMeta((m) => ({ ...m, periodMonth: Number(v) }))}>
                <SelectTrigger id="edit-month" className="w-full" aria-invalid={errors.periodMonth ? true : undefined} aria-describedby={errors.periodMonth ? "edit-month-error" : undefined}>
                  <SelectValue placeholder="Elige el mes">{(v: string) => (v ? capitalize(MONTHS_FULL[Number(v) - 1] ?? "") : "Elige el mes")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTHS_FULL.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{capitalize(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldError id="edit-month-error" message={errors.periodMonth} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-year">Año</Label>
              <DecimalInput id="edit-year" value={meta.periodYear} onValueChange={(v) => setMeta((m) => ({ ...m, periodYear: v }))} placeholder="AAAA" aria-invalid={errors.periodYear ? true : undefined} aria-describedby={errors.periodYear ? "edit-year-error" : undefined} />
              <FieldError id="edit-year-error" message={errors.periodYear} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-gross">Bruto (€)</Label>
              <DecimalInput id="edit-gross" value={meta.grossSalary} onValueChange={(v) => setMeta((m) => ({ ...m, grossSalary: v }))} placeholder="Sin dato" className="tabular-nums" aria-invalid={errors.grossSalary ? true : undefined} aria-describedby={errors.grossSalary ? "edit-gross-error" : undefined} />
              <FieldError id="edit-gross-error" message={errors.grossSalary} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-net">Neto (€)</Label>
              <DecimalInput id="edit-net" value={meta.netSalary} onValueChange={(v) => setMeta((m) => ({ ...m, netSalary: v }))} placeholder="Sin dato" className="tabular-nums" aria-invalid={errors.netSalary ? true : undefined} aria-describedby={errors.netSalary ? "edit-net-error" : undefined} />
              <FieldError id="edit-net-error" message={errors.netSalary} />
            </div>
          </div>
          {errors.concepts && <p role="alert" className="mt-3 text-sm text-destructive">{errors.concepts}</p>}
        </SectionCard>
      ) : (
        <StatGrid className="mb-6">
          <StatCard label="Líquido a percibir" value={formatCurrency(payslip.netSalary)} emphasis hint={gross ? `Te llega el ${formatPct((net / gross) * 100)} del bruto` : undefined} />
          <StatCard label="Salario bruto" value={formatCurrency(payslip.grossSalary)} hint={`${devengos.length} ${devengos.length === 1 ? "devengo" : "devengos"}`} />
          <StatCard label="IRPF" className="hidden sm:flex" value={formatCurrency(irpf)} hint={gross ? `Retención del ${formatPct((irpf / gross) * 100)}` : undefined} />
          <StatCard label="Total deducciones" className="hidden sm:flex" value={formatCurrency(Math.max(gross - net, 0))} hint={`${deducciones.length} ${deducciones.length === 1 ? "concepto" : "conceptos"}`} />
        </StatGrid>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <ConceptTable
            title="Devengos"
            tone="devengo"
            concepts={devengos}
            allConcepts={shownConcepts}
            editing={editing}
            onChange={updateConcept}
            onRemove={removeConcept}
            onAdd={() => addConcept("devengo")}
            invalidAmounts={!!errors.concepts}
          />
          <ConceptTable
            title="Deducciones"
            tone="deduccion"
            concepts={deducciones}
            allConcepts={shownConcepts}
            editing={editing}
            onChange={updateConcept}
            onRemove={removeConcept}
            onAdd={() => addConcept("deduccion")}
            invalidAmounts={!!errors.concepts}
          />
        </div>
        <NotesCard payslipId={payslip.id} />
        </div>

        <div className="space-y-6">
          {!editing && gross > 0 && <BreakdownCard payslip={payslip} />}
          <LinkIncomeCard payslipId={payslip.id} linkedTransaction={payslip.linkedTransaction} />
          <TagsCard payslipId={payslip.id} />
          <SectionCard title="Archivo" icon={FileText}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Nombre</dt>
                <dd className="min-w-0 truncate text-right font-medium text-foreground" title={payslip.fileName}>{payslip.fileName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Subida</dt>
                <dd className="text-foreground">{new Date(payslip.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</dd>
              </div>
            </dl>
            {payslip.rawText ? (
              <details className="group mt-4 rounded-lg border border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Texto extraído del PDF
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <pre className="max-h-72 overflow-auto border-t border-border bg-muted/40 p-3 [font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {payslip.rawText}
                </pre>
              </details>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">El PDF original no se guarda: solo los datos extraídos.</p>
            )}
          </SectionCard>
        </div>
      </div>

      <ConfirmModal
        open={confirmReprocess}
        title="¿Reprocesar esta nómina?"
        message={
          payslip.manuallyEdited
            ? "Se volverán a leer los datos del texto extraído y se sustituirán los conceptos actuales. Perderás las correcciones que hiciste a mano."
            : "Se volverán a leer los datos del texto extraído y se sustituirán los conceptos actuales."
        }
        confirmLabel="Reprocesar"
        variant="warning"
        onConfirm={() => {
          setConfirmReprocess(false);
          onReprocess();
        }}
        onCancel={() => setConfirmReprocess(false)}
      />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="text-xs text-destructive">{message}</p>;
}
