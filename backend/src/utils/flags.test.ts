import { describe, expect, it } from "vitest";
import { flagSchema, normalizeFlag } from "./flags.js";

describe("marcas de color", () => {
  it("normaliza las de YNAB y descarta lo demás", () => {
    expect(normalizeFlag("Red")).toBe("red");
    expect(normalizeFlag(" purple ")).toBe("purple");
    expect(normalizeFlag("Fucsia")).toBeNull();
    expect(normalizeFlag(null)).toBeNull();
  });
  it("la API acepta un color o vacío y rechaza el resto", () => {
    expect(flagSchema.parse("Blue")).toBe("blue");
    expect(flagSchema.parse("")).toBeNull();
    expect(flagSchema.parse(null)).toBeNull();
    expect(flagSchema.safeParse("fucsia").success).toBe(false);
  });
});
