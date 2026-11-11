/** Minúsculas y sin tildes, para buscar sin importar cómo se escribió. */
export function normalizeSearch(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
