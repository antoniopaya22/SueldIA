import { describe, expect, it } from "vitest";
import { batchSchema } from "./transaction-batch.service.js";

describe("batchSchema", () => {
  it("acepta cada acción con sus datos", () => {
    expect(batchSchema.safeParse({ action: "set-category", ids: [1, 2], categoryId: 5 }).success).toBe(true);
    expect(batchSchema.safeParse({ action: "set-category", ids: [1], categoryId: null }).success).toBe(true);
    expect(batchSchema.safeParse({ action: "set-cleared", ids: [1], cleared: false }).success).toBe(true);
    expect(batchSchema.safeParse({ action: "delete", ids: [1] }).success).toBe(true);
  });

  it("rechaza lotes vacíos o demasiado grandes", () => {
    expect(batchSchema.safeParse({ action: "delete", ids: [] }).success).toBe(false);
    expect(batchSchema.safeParse({ action: "delete", ids: Array.from({ length: 501 }, (_, i) => i + 1) }).success).toBe(false);
  });

  it("rechaza acciones desconocidas y datos que faltan", () => {
    expect(batchSchema.safeParse({ action: "boom", ids: [1] }).success).toBe(false);
    expect(batchSchema.safeParse({ action: "set-cleared", ids: [1] }).success).toBe(false);
    expect(batchSchema.safeParse({ action: "set-category", ids: [1] }).success).toBe(false);
    expect(batchSchema.safeParse({ action: "delete", ids: [0] }).success).toBe(false);
  });
});
