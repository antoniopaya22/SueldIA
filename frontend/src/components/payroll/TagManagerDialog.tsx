import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteTag, getTags, updateTag, type Tag } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TAG_COLORS } from "./shared";
import { cn } from "cn";

function TagRow({ tag }: { tag: Tag }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(tag.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["payslips"] });
    queryClient.invalidateQueries({ queryKey: ["payslip-tags"] });
  };
  const updateMut = useMutation({
    mutationFn: (data: { name?: string; color?: string }) => updateTag(tag.id, data),
    onSuccess: refresh,
    onError: (e: Error) => { toast.error(e.message); setName(tag.name); },
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteTag(tag.id),
    onSuccess: () => { refresh(); toast.success(`Etiqueta «${tag.name}» eliminada`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(tag.name);
    if (next !== tag.name) updateMut.mutate({ name: next });
  };
  const nextColor = TAG_COLORS[(TAG_COLORS.indexOf(tag.color) + 1) % TAG_COLORS.length];

  return (
    <li className="flex items-center gap-2 py-2">
      <button
        type="button"
        onClick={() => updateMut.mutate({ color: nextColor })}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted"
        aria-label={`Cambiar el color de «${tag.name}»`}
        title="Cambiar color"
      >
        <span className="size-3 rounded-full" style={{ backgroundColor: tag.color }} />
      </button>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setName(tag.name); }}
        maxLength={50}
        aria-label={`Nombre de la etiqueta «${tag.name}»`}
        className="h-8"
      />
      {confirmDelete ? (
        <Button variant="destructive" size="sm" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} onBlur={() => setConfirmDelete(false)} autoFocus>
          ¿Seguro?
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label={`Eliminar la etiqueta «${tag.name}»`}>
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      )}
      <Check className={cn("size-4 shrink-0 text-primary transition-opacity", updateMut.isSuccess ? "opacity-100" : "opacity-0")} aria-hidden="true" />
    </li>
  );
}

/** Renombrar, recolorear y eliminar etiquetas (eliminarla la quita de todas las nóminas). */
export function TagManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: tags = [], isLoading } = useQuery({ queryKey: ["tags"], queryFn: getTags, enabled: open });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Etiquetas</DialogTitle>
          <DialogDescription>Cámbiales el nombre o el color. Eliminar una la quita de todas las nóminas que la llevan.</DialogDescription>
        </DialogHeader>
        {isLoading ? null : tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no tienes etiquetas. Se crean desde el detalle de una nómina o al etiquetar varias a la vez.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-auto">
            {tags.map((t) => <TagRow key={t.id} tag={t} />)}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
