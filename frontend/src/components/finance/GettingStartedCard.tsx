import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Rocket, X } from "lucide-react";
import { getAccounts, getCategories, getTransactions } from "../../lib/api";
import { openNewTransaction } from "../../lib/new-transaction";
import { useSeedDefaultCategories } from "../categories/useSeedDefaultCategories";
import { SectionCard } from "../app";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

const DISMISS_KEY = "sueldia:getting-started-dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

interface Step {
  key: string;
  title: string;
  description: string;
  done: boolean;
  action: ReactNode;
}

/**
 * Primeros pasos: cuenta → categorías → primer movimiento. Se calcula con los
 * datos reales (no guarda nada), así que se marca sola; desaparece al terminar
 * o si el usuario la oculta (salvo que `alwaysShow`, p. ej. sin cuentas).
 */
export function GettingStartedCard({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [dismissed, setDismissed] = useState(wasDismissed);
  const seed = useSeedDefaultCategories();

  const { data: accounts, isLoading: loadingAccounts } = useQuery({ queryKey: ["accounts"], queryFn: getAccounts });
  const { data: groups, isLoading: loadingGroups } = useQuery({ queryKey: ["categories"], queryFn: getCategories });
  const { data: txPage, isLoading: loadingTx } = useQuery({
    queryKey: ["transactions", "getting-started"],
    queryFn: () => getTransactions({ limit: 1 }),
  });

  if (loadingAccounts || loadingGroups || loadingTx) return null;

  const hasAccount = (accounts ?? []).some((a) => !a.archived);
  const hasCategories = (groups ?? []).some((g) => g.categories.length > 0);
  const hasMovement = (txPage?.total ?? 0) > 0;

  const steps: Step[] = [
    {
      key: "account",
      title: "Crea tu primera cuenta",
      description: "El banco, la tarjeta o el efectivo donde está tu dinero, con su saldo de hoy.",
      done: hasAccount,
      action: <a href="/app/accounts" className={buttonVariants({ size: "sm" })}>Crear cuenta</a>,
    },
    {
      key: "categories",
      title: "Prepara tus categorías",
      description: "Vivienda, alimentación, transporte… Empieza con las de siempre y cámbialas cuando quieras.",
      done: hasCategories,
      action: (
        <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? "Creando…" : "Usar las de partida"}
        </Button>
      ),
    },
    {
      key: "movement",
      title: "Apunta tu primer movimiento",
      description: "Un gasto o un ingreso. Con la tecla N lo apuntas desde cualquier página.",
      done: hasMovement,
      action: (
        <Button size="sm" onClick={() => openNewTransaction()} disabled={!hasAccount}>
          Nueva transacción
        </Button>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  if (dismissed && !alwaysShow) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sin almacenamiento: se oculta solo en esta visita.
    }
    setDismissed(true);
  };

  return (
    <SectionCard
      className="mb-6"
      title="Primeros pasos"
      description={`${doneCount} de ${steps.length} · lo justo para empezar a ver tus finanzas`}
      icon={Rocket}
      action={
        !alwaysShow ? (
          <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Ocultar los primeros pasos" title="Ocultar">
            <X className="size-4" />
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Progreso de los primeros pasos">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="space-y-3">
        {steps.map((step, i) => {
          // El siguiente paso pendiente es el que se destaca; los demás quedan accesibles pero discretos.
          const isNext = !step.done && steps.slice(0, i).every((s) => s.done);
          return (
            <li key={step.key} className={cn("flex items-start gap-3 rounded-lg border p-3", step.done ? "border-border bg-muted/30" : isNext ? "border-primary/30 bg-primary/5" : "border-border")}>
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", step.done ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                {step.done ? <Check className="size-3" aria-hidden="true" /> : <Circle className="size-4" aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", step.done ? "text-muted-foreground line-through" : "text-foreground")}>{step.title}</p>
                {!step.done && <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>}
              </div>
              {!step.done && <div className="shrink-0">{step.action}</div>}
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
