import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, Link2, Loader2, UserMinus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  acceptShareInvite, createShareInvite, deleteShareInvite, getSharing, leaveShare, removeShareViewer,
} from "../../lib/api";
import { getViewAs, switchViewAs } from "../../lib/view-as";
import { SectionCard } from "../app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const day = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long" });
const who = (p: { name: string | null; email: string }) => p.name?.trim() || p.email;

/** Lee ?invitacion=… de la URL (una vez) y la quita para no aceptarla dos veces. */
function useInviteFromUrl(): [string | null, () => void] {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("invitacion");
    if (!t) return;
    setToken(t);
    url.searchParams.delete("invitacion");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return [token, () => setToken(null)];
}

/** Compartir tus datos en solo lectura, y ver los de quien los comparte contigo. */
export function SharingSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["sharing"], queryFn: getSharing });
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteToken, clearInvite] = useInviteFromUrl();
  const viewing = getViewAs();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["sharing"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  const createMut = useMutation({
    mutationFn: createShareInvite,
    onSuccess: (r) => {
      setLink({ url: `${window.location.origin}/app/settings?invitacion=${encodeURIComponent(r.token)}`, expiresAt: r.expiresAt });
      setCopied(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const acceptMut = useMutation({
    mutationFn: acceptShareInvite,
    onSuccess: (r) => { toast.success(`Ya puedes ver los datos de ${r.owner.name || "esa persona"}`); clearInvite(); refresh(); },
    onError: (e: Error) => { toast.error(e.message); clearInvite(); },
  });
  const action = (fn: () => Promise<unknown>, ok: string) => fn().then(() => { toast.success(ok); refresh(); }, (e: Error) => toast.error(e.message));

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      toast.error("No se pudo copiar: selecciona el enlace y cópialo a mano");
    }
  };

  return (
    <SectionCard
      title="Compartir"
      icon={Users}
      description="Deja que otra persona (tu pareja, tu gestor…) vea tus nóminas y finanzas. Solo podrá mirar: nada de cambiar, borrar ni descargar."
    >
      {isLoading || !data ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Invitar a alguien</p>
                <p className="text-xs text-muted-foreground">Un enlace de un solo uso que caduca a los 7 días. Mándaselo por donde quieras.</p>
              </div>
              <Button variant="outline" onClick={() => createMut.mutate()} disabled={createMut.isPending} className="gap-1.5">
                {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Crear enlace
              </Button>
            </div>
            {link && (
              <div className="flex gap-2">
                <Input readOnly value={link.url} aria-label="Enlace de invitación" onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                <Button variant="outline" onClick={copy} className="shrink-0 gap-1.5">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
            )}
            {data.invites.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {data.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="flex-1">Enlace sin usar · caduca el {day(i.expiresAt)}</span>
                    <Button variant="ghost" size="icon-sm" aria-label="Cancelar la invitación" onClick={() => action(() => deleteShareInvite(i.id), "Invitación cancelada")}>
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <PeopleList
            title="Pueden ver tus datos"
            empty="Nadie, de momento."
            people={data.myViewers}
            actionLabel="Quitar acceso"
            actionIcon={UserMinus}
            onAction={(p) => action(() => removeShareViewer(p.userId), `${who(p)} ya no puede ver tus datos`)}
          />

          <PeopleList
            title="Compartidos contigo"
            empty="Nadie ha compartido sus datos contigo."
            people={data.sharedWithMe}
            actionLabel="Dejar de ver"
            actionIcon={X}
            onAction={(p) => action(() => leaveShare(p.userId), `Has dejado de ver los datos de ${who(p)}`)}
            primary={(p) =>
              viewing?.id === p.userId ? (
                <Button size="sm" variant="outline" onClick={() => switchViewAs(null)}>Volver a los míos</Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => switchViewAs({ id: p.userId, name: who(p) })}>
                  <Eye className="size-3.5" /> Ver
                </Button>
              )
            }
          />
        </div>
      )}

      <AlertDialog open={!!inviteToken} onOpenChange={(o) => { if (!o) clearInvite(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aceptar la invitación</AlertDialogTitle>
            <AlertDialogDescription>
              Alguien quiere enseñarte sus nóminas y finanzas en SueldIA. Podrás verlas (sin cambiar nada) desde Ajustes → Compartir. Tus datos siguen siendo solo tuyos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ahora no</AlertDialogCancel>
            <AlertDialogAction disabled={acceptMut.isPending} onClick={() => inviteToken && acceptMut.mutate(inviteToken)}>
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function PeopleList({ title, empty, people, actionLabel, actionIcon: ActionIcon, onAction, primary }: {
  title: string;
  empty: string;
  people: Array<{ userId: number; name: string | null; email: string; since: string }>;
  actionLabel: string;
  actionIcon: typeof X;
  onAction: (p: { userId: number; name: string | null; email: string }) => void;
  primary?: (p: { userId: number; name: string | null; email: string }) => React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{who(p)}</p>
                <p className="truncate text-xs text-muted-foreground">{p.name?.trim() && p.name.trim() !== p.email ? `${p.email} · ` : ""}desde el {day(p.since)}</p>
              </div>
              {primary?.(p)}
              <Button size="icon-sm" variant="ghost" aria-label={`${actionLabel}: ${who(p)}`} onClick={() => onAction(p)}>
                <ActionIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
