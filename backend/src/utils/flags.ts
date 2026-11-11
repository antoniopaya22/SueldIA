import { z } from "zod";

/**
 * Marcas de color de un movimiento (las mismas seis que YNAB, que las importa
 * en inglés y con mayúscula: «Red»). Se guardan en minúscula.
 */
export const FLAG_VALUES = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type FlagValue = (typeof FLAG_VALUES)[number];

/** Normaliza una marca: minúsculas; cualquier otra cosa → null. */
export function normalizeFlag(value: unknown): FlagValue | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (FLAG_VALUES as readonly string[]).includes(v) ? (v as FlagValue) : null;
}

/** Marca en la API: uno de los seis colores (sin distinguir mayúsculas) o vacía. */
export const flagSchema = z
  .string()
  .max(20)
  .nullish()
  .refine((v) => v == null || v === "" || normalizeFlag(v) !== null, "Marca no válida")
  .transform((v) => (v == null || v === "" ? null : normalizeFlag(v)));
