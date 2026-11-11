import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Bell, FileText, Goal, HardDriveDownload, History, Landmark, Loader2, PiggyBank, Repeat, Receipt, Sparkles, Tag, Tags, Upload, Users, Wand2,
  type LucideIcon,
} from "lucide-react";
import { getActivity, type ActivityEntry } from "../../lib/api";
import { SectionCard } from "../app";
import { Button } from "@/components/ui/button";

const ICONS: Record<string, LucideIcon> = {
  transaction: Receipt,
  recurring: Repeat,
  account: Landmark,
  category: Tags,
  rule: Wand2,
  budget: PiggyBank,
  import: Upload,
  backup: HardDriveDownload,
  payslip: FileText,
  profile: Users,
  alert: Bell,
  goal: Goal,
  tag: Tag,
  demo: Sparkles,
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

/** «Qué ha cambiado y cuándo»: las últimas acciones que modificaron tus datos. */
export function ActivitySection() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["activity"],
    queryFn: ({ pageParam }) => getActivity(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 0,
  });
  const entries = data?.pages.flatMap((p) => p.data) ?? [];
  const groups: Array<{ day: string; items: ActivityEntry[] }> = [];
  for (const e of entries) {
    const day = dayLabel(e.createdAt);
    if (groups[groups.length - 1]?.day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(e);
  }

  return (
    <SectionCard title="Actividad" description="Lo que ha cambiado en tus datos y cuándo: altas, ediciones, importaciones y acciones en lote. Se guarda 180 días." icon={History}>
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted/50" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">No se pudo cargar la actividad.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay nada. Aquí verás lo que vayas cambiando.</p>
      ) : (
        <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground first-letter:uppercase">{g.day}</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.items.map((e) => {
                  const Icon = ICONS[e.entity] ?? History;
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-foreground">{e.summary}</span>
                      <time dateTime={e.createdAt} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(e.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hasNextPage && (
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-muted-foreground" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
              Ver más
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
