// Marcas de color de un movimiento (las seis de YNAB). El valor que guarda la
// API va en inglés; en la URL y en pantalla, en español.

export const FLAG_VALUES = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type FlagValue = (typeof FLAG_VALUES)[number];

export const FLAGS: ReadonlyArray<{ value: FlagValue; label: string; slug: string; dot: string }> = [
  { value: "red", label: "Roja", slug: "roja", dot: "bg-red-500" },
  { value: "orange", label: "Naranja", slug: "naranja", dot: "bg-orange-500" },
  { value: "yellow", label: "Amarilla", slug: "amarilla", dot: "bg-yellow-400" },
  { value: "green", label: "Verde", slug: "verde", dot: "bg-emerald-500" },
  { value: "blue", label: "Azul", slug: "azul", dot: "bg-sky-500" },
  { value: "purple", label: "Morada", slug: "morada", dot: "bg-violet-500" },
];

export function flagMeta(value: string | null | undefined) {
  return FLAGS.find((f) => f.value === value?.toLowerCase()) ?? null;
}

/** «roja» → "red"; «cualquiera» → "any". */
export function flagFromSlug(slug: string | null): FlagValue | "any" | undefined {
  if (!slug) return undefined;
  if (slug === "cualquiera") return "any";
  return FLAGS.find((f) => f.slug === slug)?.value;
}

export function flagToSlug(flag: FlagValue | "any"): string {
  return flag === "any" ? "cualquiera" : FLAGS.find((f) => f.value === flag)!.slug;
}
