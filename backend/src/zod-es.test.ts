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
  it("enumerados, infinitos, formatos y listas (cambiaron de forma en Zod 4)", () => {
    const msg = (schema: z.ZodType, value: unknown) => schema.safeParse(value).error?.issues[0].message;
    expect(msg(z.enum(["a", "b"]), "c")).toBe("Valor no válido. Opciones: a, b");
    expect(msg(z.number(), Infinity)).toBe("Debe ser un número finito");
    expect(msg(z.number(), "x")).toBe("Tipo no válido: se esperaba un número");
    expect(msg(z.string().regex(/^\d+$/), "x")).toBe("Formato no válido");
    expect(msg(z.array(z.number()).max(2), [1, 2, 3])).toBe("Máximo 2 elementos");
    expect(msg(z.string().max(3), "abcd")).toBe("Máximo 3 caracteres");
    expect(msg(z.object({ a: z.number() }).strict(), { a: 1, b: 2 })).toBe("Campos no admitidos: b");
  });
});
