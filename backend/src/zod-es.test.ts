import { describe, expect, it } from "vitest";
import { z } from "zod";
import "./zod-es.js";

describe("mensajes de Zod en español", () => {
  it("traduce los errores comunes y respeta los mensajes propios", () => {
    const schema = z.object({ name: z.string().min(1), amount: z.number().positive("El importe debe ser mayor que cero") });
    const r = schema.safeParse({ name: "", amount: -1 });
    expect(r.success).toBe(false);
    const errors = r.success ? {} : r.error.flatten().fieldErrors;
    expect(errors.name).toEqual(["No puede estar vacío"]);
    expect(errors.amount).toEqual(["El importe debe ser mayor que cero"]);
    expect(z.object({ x: z.number() }).safeParse({}).error?.issues[0].message).toBe("Campo obligatorio");
  });
});
