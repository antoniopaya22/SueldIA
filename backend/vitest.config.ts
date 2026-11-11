import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    // Las pruebas de integración comparten una única BBDD: sin paralelismo
    // entre ficheros, un TRUNCATE de uno no pisa los datos de otro.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
