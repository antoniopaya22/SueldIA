import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Solo lógica pura de src/lib (sin navegador): formatos, filtros, fechas…
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
