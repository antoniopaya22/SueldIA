import { useMemo, useState } from "react";
import { useLeaveGuard } from "../../hooks/use-leave-guard";
import { deferWithUndo } from "../../lib/undo";
import { ComparisonCard } from "./ComparisonCard";
import { setUrlParams } from "../../lib/url-state";
import { irpfAmount, socialSecurityAmount } from "../../lib/payslip-concepts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRightLeft, Check, ChevronLeft, ChevronRight, ArrowLeft, Building2, ChevronDown, FileText, Gift, Link2, Loader2, MoreHorizontal,
  NotebookPen, Pencil, Plus, RefreshCw, Save, Search, Tag as TagIcon, Trash2, Unlink, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignTag, createNote, createTag, deleteNote, getNotes, getPayslipTags, getTags, removeTag, updateNote,
  getPayslipLinkSuggestions, getTransactions, linkPayslipTransaction,
  updatePayslipConcepts, updatePayslipType, markPayslipReviewed, movePayslipToProfile, getPayslipComparison,
  type Payslip, type PayslipConcept, type PayslipLinkCandidate,
} from "../../lib/api";
import { formatCurrency, formatPct } from "../../lib/format";
import { DecimalInput, PageHeader, SectionCard, StatCard, StatGrid } from "../app";
import { ConfirmModal } from "../ui/ConfirmModal";
import { StatusBadge, ExtraBadge, MONTHS_FULL, TAG_COLORS, formatPeriod } from "./shared";
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
import { OcrButton } from "./OcrButton";

// El backend devuelve la fila completa (incluido el texto extraído), aunque
// el tipo compartido no lo declare.
export type PayslipWithConcepts = Payslip & { concepts: PayslipConcept[]; rawText?: string | null };


function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Conceptos ──────────────────────────────────────────────────
function ConceptTable({
  title, tone, concepts, allConcepts, editing, onChange, onRemove, onAdd, invalidAmounts,
}: {
  title: string;
  tone: "devengo" | "deduccion" | "otros";
  concepts: PayslipConcept[];
  allConcepts: PayslipConcept[];
  editing: boolean;
  onChange: (index: number, patch: Partial<Pick<PayslipConcept, "name" | "amount" | "category" | "isPercentage">>) => void;
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
          <span className={cn("size-2 rounded-full", tone === "devengo" ? "bg-primary-500 dark:bg-primary" : tone === "deduccion" ? "bg-red-500" : "bg-slate-400")} />
          {title}
          <span className="font-normal text-muted-foreground">· {concepts.length}</span>
        </span>
      }
      flush
      footer={
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-muted-foreground">Total {tone === "devengo" ? "devengado" : tone === "deduccion" ? "deducciones" : "otros"}</span>
          <span className={cn("font-semibold tabular-nums", tone === "deduccion" ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {tone === "deduccion" && total > 0 ? "−" : ""}{formatCurrency(total)}
          </span>
        </div>
      }
    >
      {sorted.length === 0 && !editing ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          {tone === "devengo" ? "No se detectaron devengos." : tone === "deduccion" ? "No se detectaron deducciones." : "Sin otros conceptos."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((c) => {
            const realIndex = allConcepts.indexOf(c);
            return (
              <li key={realIndex} className={cn("px-5 py-2.5", editing ? "space-y-2" : "flex items-center gap-3")}>
                {editing ? (
                  <>
                    {/* Dos líneas: con todo en una, el nombre se quedaba sin sitio. */}
                    <div className="flex items-center gap-2">
                      <Input
                        value={c.name}
                        onChange={(e) => onChange(realIndex, { name: e.target.value })}
                        placeholder="Concepto"
                        aria-label="Nombre del concepto"
                        className="h-8 min-w-0 flex-1"
                      />
                      <Button variant="ghost" size="icon-sm" onClick={() => onRemove(realIndex)} aria-label={`Quitar ${c.name || "concepto"}`} className="shrink-0 text-muted-foreground hover:text-destructive">
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <DecimalInput
                        value={c.amount}
                        // Vacío o no numérico → NaN: el formulario lo marca al guardar.
                        onValueChange={(v) => onChange(realIndex, { amount: v ?? Number.NaN })}
                        aria-label={`Importe de ${c.name || "concepto"}`}
                        aria-invalid={invalidAmounts && !Number.isFinite(c.amount) ? true : undefined}
                        className="h-8 w-28 text-right tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => onChange(realIndex, { isPercentage: !c.isPercentage })}
                        aria-pressed={c.isPercentage}
                        aria-label={`${c.name || "Concepto"}: ${c.isPercentage ? "es un porcentaje" : "es un importe en euros"}`}
                        title={c.isPercentage ? "Es un porcentaje (no suma en euros)" : "Importe en euros"}
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-md border text-xs font-medium tabular-nums transition-colors",
                          c.isPercentage ? "border-primary/40 bg-primary/10 text-primary-700 dark:text-primary" : "border-input text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {c.isPercentage ? "%" : "€"}
                      </button>
                      {/* Cambiar de sección: un concepto mal clasificado por el analizador. */}
                      <select
                        value={c.category}
                        onChange={(e) => onChange(realIndex, { category: e.target.value as PayslipConcept["category"] })}
                        aria-label={`Sección de ${c.name || "concepto"}`}
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs text-muted-foreground dark:bg-input/30"
                      >
                        <option value="devengo">Devengo</option>
                        <option value="deduccion">Deducción</option>
                        <option value="otros">Otros</option>
                      </select>
                    </div>
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
                <Plus className="size-3.5" /> Añadir {tone === "devengo" ? "devengo" : tone === "deduccion" ? "deducción" : "concepto"}
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
  const irpf = irpfAmount(payslip.concepts);
  // Seguridad Social con su propio importe (conceptos clasificados); lo que no
  // cuadra (anticipos, embargos…) va a «Otras deducciones». Antes todo lo que
  // no era IRPF se llamaba «Seg. Social y otros».
  const socialSecurity = socialSecurityAmount(payslip.concepts);
  const other = Math.max(gross - net - irpf - socialSecurity, 0);
  const segments = [
    { label: "Neto", value: net, className: "bg-primary-500 dark:bg-primary" },
    { label: "IRPF", value: irpf, className: "bg-amber-400" },
    ...(socialSecurity > 0
      ? [{ label: "Seguridad Social", value: socialSecurity, className: "bg-brand-navy/70 dark:bg-slate-500" }]
      : []),
    { label: socialSecurity > 0 ? "Otras deducciones" : "Seg. Social y otros", value: other, className: socialSecurity > 0 ? "bg-slate-300 dark:bg-slate-600" : "bg-brand-navy/70 dark:bg-slate-500" },
  ].filter((s) => s.value > 0.005 || s.label === "Neto");
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

  // La lista de nóminas también enseña las etiquetas: se refrescan las dos.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["payslip-tags", payslipId] });
    queryClient.invalidateQueries({ queryKey: ["payslips"] });
  };
  const assignMut = useMutation({
    mutationFn: (tagId: number) => assignTag(payslipId, tagId),
    onSuccess: refresh,
    onError: (e: Error) => toast.error("No se pudo añadir la etiqueta", { description: e.message }),
  });
  const removeMut = useMutation({
    mutationFn: (tagId: number) => removeTag(payslipId, tagId),
    onSuccess: refresh,
    onError: (e: Error) => toast.error("No se pudo quitar la etiqueta", { description: e.message }),
  });
  const createMut = useMutation({
    mutationFn: (name: string) => createTag(name, TAG_COLORS[allTags.length % TAG_COLORS.length]),
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      setNewTag("");
      assignMut.mutate(tag.id);
    },
    onError: (e: Error) => toast.error("No se pudo crear la etiqueta", { description: e.message }),
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
                className="flex size-5 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-7"
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
  const [editing, setEditing] = useState<{ id: number; content: string } | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notes", payslipId] });
    queryClient.invalidateQueries({ queryKey: ["payslips"] }); // la búsqueda mira las notas
  };
  const editMut = useMutation({
    mutationFn: (e: { id: number; content: string }) => updateNote(e.id, e.content.trim()),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e: Error) => toast.error("No se pudo guardar la nota", { description: e.message }),
  });
  const addMut = useMutation({
    mutationFn: () => createNote(payslipId, content.trim()),
    onSuccess: () => { setContent(""); refresh(); },
    onError: (e: Error) => toast.error("No se pudo guardar la nota", { description: e.message }),
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
            <li key={n.id} className="group relative rounded-lg border border-border bg-muted/30 p-3 pr-16">
              {editing?.id === n.id ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (editing.content.trim()) editMut.mutate(editing); }}
                  className="space-y-2"
                >
                  <Label htmlFor={`edit-note-${n.id}`} className="sr-only">Editar nota</Label>
                  <Textarea
                    id={`edit-note-${n.id}`}
                    value={editing.content}
                    onChange={(e) => setEditing({ id: n.id, content: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }}
                    rows={3}
                    maxLength={2000}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                    <Button type="submit" size="sm" disabled={!editing.content.trim() || editMut.isPending}>Guardar</Button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{n.content}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </>
              )}
              {editing?.id !== n.id && (
                // Visibles siempre en pantallas táctiles (sin hover no se veían).
                <div className="absolute top-1.5 right-1.5 flex transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditing({ id: n.id, content: n.content })}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Editar nota"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Borrar nota"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
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
  netSalary,
}: {
  payslipId: number;
  linkedTransaction: PayslipLinkCandidate | null | undefined;
  netSalary: number | null;
}) {
  // Neto de la nómina frente a lo que llegó al banco: si no cuadran, o el
  // analizador leyó mal el neto o hay un embargo/anticipo que conviene ver.
  const mismatch =
    linkedTransaction && netSalary != null && Math.abs(linkedTransaction.amount - netSalary) >= 1
      ? linkedTransaction.amount - netSalary
      : null;
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
    onError: (e: Error) => toast.error("No se pudo quitar el vínculo", { description: e.message }),
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
              {new Date(`${linkedTransaction.date}T00:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            {mismatch != null && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  El abono es {formatCurrency(Math.abs(mismatch))} {mismatch > 0 ? "mayor" : "menor"} que el neto de la nómina ({formatCurrency(netSalary)}).
                  Revisa si el neto se leyó bien o si hubo un anticipo o embargo.
                </span>
              </p>
            )}
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
  payslip, profileName, profiles = [], onBack, onDelete, onReprocess, isReprocessing, onEditingChange, onOpen,
}: {
  /** Abrir otra nómina (anterior/siguiente). */
  onOpen?: (id: number) => void;
  payslip: PayslipWithConcepts;
  profileName?: string;
  /** Perfiles del usuario, para «Mover a otro perfil». */
  profiles?: Array<{ id: number; name: string }>;
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
  const { data: neighbors } = useQuery({ queryKey: ["payslip-compare", payslip.id], queryFn: () => getPayslipComparison(payslip.id) });

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

  const reviewedMut = useMutation({
    mutationFn: () => markPayslipReviewed(payslip.id),
    onSuccess: () => { invalidate(); toast.success("Nómina marcada como revisada"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveMut = useMutation({
    mutationFn: (profileId: number) => movePayslipToProfile(payslip.id, profileId),
    onSuccess: (_d, profileId) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setUrlParams({ perfil: profileId });
      toast.success(`Nómina movida a ${profiles.find((p) => p.id === profileId)?.name ?? "otro perfil"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const typeMut = useMutation({
    mutationFn: (type: "ordinal" | "extra") => updatePayslipType(payslip.id, type),
    onSuccess: (_d, type) => {
      invalidate();
      toast.success(type === "extra" ? "Marcada como paga extra" : "Marcada como nómina mensual");
    },
    onError: (e: Error) => toast.error("No se pudo cambiar el tipo", { description: e.message }),
  });

  const shownConcepts = editing ? concepts : payslip.concepts;
  const devengos = shownConcepts.filter((c) => c.category === "devengo");
  const deducciones = shownConcepts.filter((c) => c.category === "deduccion");
  const otros = shownConcepts.filter((c) => c.category === "otros");

  // Comprobación en vivo mientras se edita: antes los avisos de cuadre se
  // ocultaban justo al editar, que es cuando hacen falta.
  const liveChecks = useMemo(() => {
    if (!editing) return [];
    const sum = (cat: PayslipConcept["category"]) =>
      concepts.filter((c) => c.category === cat && !c.isPercentage && Number.isFinite(c.amount)).reduce((s, c) => s + c.amount, 0);
    const devengado = sum("devengo");
    const deducido = sum("deduccion");
    const checks: Array<{ ok: boolean; text: string }> = [];
    if (meta.grossSalary != null && Number.isFinite(meta.grossSalary) && devengado > 0) {
      const ok = Math.abs(devengado - meta.grossSalary) < Math.max(1, meta.grossSalary * 0.005);
      checks.push({ ok, text: `Devengos ${formatCurrency(devengado)} ${ok ? "=" : "≠"} bruto ${formatCurrency(meta.grossSalary)}` });
    }
    if (meta.grossSalary != null && meta.netSalary != null && Number.isFinite(meta.grossSalary) && Number.isFinite(meta.netSalary) && deducido > 0) {
      const expected = meta.grossSalary - deducido;
      const ok = Math.abs(expected - meta.netSalary) < Math.max(1, meta.netSalary * 0.005);
      checks.push({ ok, text: `Bruto − deducciones = ${formatCurrency(expected)} ${ok ? "=" : "≠"} neto ${formatCurrency(meta.netSalary)}` });
    }
    return checks;
  }, [editing, concepts, meta.grossSalary, meta.netSalary]);
  const gross = payslip.grossSalary ?? 0;
  const net = payslip.netSalary ?? 0;
  const irpf = useMemo(
    () => irpfAmount(payslip.concepts),
    [payslip.concepts],
  );

  // Al cambiar nombre o sección se borra el tipo: lo recalcula el servidor al guardar.
  const updateConcept = (index: number, patch: Partial<Pick<PayslipConcept, "name" | "amount" | "category" | "isPercentage">>) =>
    setConcepts((cs) => cs.map((c, i) => (i === index ? { ...c, ...patch, ...(patch.name !== undefined || patch.category ? { kind: null } : {}) } : c)));
  const addConcept = (category: "devengo" | "deduccion" | "otros") =>
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
      <div className="mb-4 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Mis nóminas
      </button>
        {/* Anterior / siguiente nómina del mismo perfil y tipo. */}
        {(neighbors?.prevId || neighbors?.nextId) && !editing && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" disabled={!neighbors?.prevId} onClick={() => neighbors?.prevId && onOpen?.(neighbors.prevId)} aria-label="Nómina anterior" title="Nómina anterior">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={!neighbors?.nextId} onClick={() => neighbors?.nextId && onOpen?.(neighbors.nextId)} aria-label="Nómina siguiente" title="Nómina siguiente">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

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
              {payslip.parsingStatus === "review" && payslip.periodMonth && payslip.periodYear && (
                <Button onClick={() => reviewedMut.mutate()} disabled={reviewedMut.isPending} className="gap-1.5">
                  <Check className="size-4" /> Marcar como revisada
                </Button>
              )}
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
                  {profiles.filter((p) => p.id !== payslip.profileId).map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => moveMut.mutate(p.id)} disabled={moveMut.isPending} className="gap-2">
                      <ArrowRightLeft className="size-4" /> Mover a {p.name}
                    </DropdownMenuItem>
                  ))}
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
          {liveChecks.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs" aria-live="polite">
              {liveChecks.map((c) => (
                <li key={c.text} className={cn("flex items-center gap-1.5 tabular-nums", c.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                  {c.ok ? <Check className="size-3.5" aria-hidden="true" /> : <AlertTriangle className="size-3.5" aria-hidden="true" />}
                  {c.text}
                </li>
              ))}
            </ul>
          )}
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
        {/* Antes los conceptos «otros» no se veían, aunque se guardaban. */}
        {(otros.length > 0 || editing) && (
          <ConceptTable
            title="Otros conceptos"
            tone="otros"
            concepts={otros}
            allConcepts={shownConcepts}
            editing={editing}
            onChange={updateConcept}
            onRemove={removeConcept}
            onAdd={() => addConcept("otros")}
            invalidAmounts={!!errors.concepts}
          />
        )}
        <NotesCard payslipId={payslip.id} />
        </div>

        <div className="space-y-6">
          {/* Al editar, el texto del PDF arriba y abierto: es la referencia para corregir. */}
          {editing && payslip.rawText && (
            <SectionCard title="Texto extraído del PDF" icon={FileText} description="Para comparar mientras corriges.">
              <pre className="max-h-[28rem] overflow-auto rounded-lg bg-muted/40 p-3 [font-family:ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {payslip.rawText}
              </pre>
            </SectionCard>
          )}
          {!editing && gross > 0 && <BreakdownCard payslip={payslip} />}
          {!editing && <ComparisonCard payslipId={payslip.id} netSalary={payslip.netSalary} grossSalary={payslip.grossSalary} />}
          <LinkIncomeCard payslipId={payslip.id} linkedTransaction={payslip.linkedTransaction} netSalary={payslip.netSalary} />
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
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <p>
                  No se pudo extraer texto de este PDF: probablemente sea un escaneo o una foto. Puedes leerlo con OCR en tu
                  navegador (el PDF no sale de tu dispositivo); como no lo guardamos, tendrás que elegirlo otra vez.
                </p>
                <OcrButton payslipId={payslip.id} />
              </div>
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
