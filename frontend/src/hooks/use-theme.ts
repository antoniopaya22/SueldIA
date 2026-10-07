import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const EVENT = "sueldia:themechange";

// Mismo criterio que el script inline de Layout.astro/login.astro: sin valor
// guardado se sigue al sistema. "system" se representa borrando la clave.
function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  // En la app (y la PWA instalada) la barra de estado sigue al tema; mismos colores que --background de .app-root.
  if (document.body.classList.contains("app-root")) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f141a" : "#faf9f6");
  }
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => {
      const pref = readPreference();
      setPreferenceState(pref);
      setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    sync();

    // Varias islas de React (shell, Ajustes) usan el hook a la vez.
    window.addEventListener(EVENT, sync);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readPreference() === "system") {
        applyTheme("system");
        sync();
      }
    };
    media.addEventListener("change", onSystemChange);
    return () => {
      window.removeEventListener(EVENT, sync);
      media.removeEventListener("change", onSystemChange);
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento (modo privado estricto): se aplica solo en esta página.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { preference, resolved, setPreference };
}
