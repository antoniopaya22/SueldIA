import { Check } from "lucide-react";
import { cn } from "cn";
import { initials } from "../../lib/format";

interface Profile {
  id: number;
  name: string;
  color: string;
}

interface ProfileSelectorProps {
  profiles: Profile[];
  value: number | number[];
  onChange: (value: number | number[]) => void;
  multi?: boolean;
}

export function ProfileSelector({ profiles, value, onChange, multi = false }: ProfileSelectorProps) {
  if (profiles.length <= 1 && !multi) return null;

  const selected = Array.isArray(value) ? value : [value];

  function handleClick(id: number) {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
      // Nunca dejar la selección vacía: equivaldría a "ningún perfil".
      onChange(next.length ? next : [id]);
    } else {
      onChange(id);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Seleccionar perfil">
      {profiles.map((p) => {
        const isSelected = selected.includes(p.id);
        const letters = initials(p.name);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => handleClick(p.id)}
            aria-pressed={isSelected}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-1 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              isSelected
                ? "border-border bg-card text-foreground shadow-sm"
                : "border-transparent bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn("flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white transition-opacity", !isSelected && "opacity-50")}
              style={{ backgroundColor: p.color }}
            >
              {isSelected && multi ? <Check className="size-3" /> : letters}
            </span>
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
