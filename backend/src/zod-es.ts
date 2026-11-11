import { z } from "zod";

// Mensajes de validación de Zod en español (por defecto salen en inglés y
// llegan al usuario en `details`). Los mensajes explícitos de cada esquema
// (p. ej. .positive("El importe…")) siguen mandando sobre estos.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === "undefined") return { message: "Campo obligatorio" };
      return { message: `Tipo no válido: se esperaba ${issue.expected === "number" ? "un número" : issue.expected === "string" ? "un texto" : issue.expected}` };
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") return { message: issue.minimum === 1 ? "No puede estar vacío" : `Mínimo ${issue.minimum} caracteres` };
      if (issue.type === "array") return { message: `Mínimo ${issue.minimum} elementos` };
      return { message: issue.inclusive ? `Debe ser mayor o igual que ${issue.minimum}` : `Debe ser mayor que ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === "string") return { message: `Máximo ${issue.maximum} caracteres` };
      if (issue.type === "array") return { message: `Máximo ${issue.maximum} elementos` };
      return { message: issue.inclusive ? `Debe ser menor o igual que ${issue.maximum}` : `Debe ser menor que ${issue.maximum}` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Valor no válido. Opciones: ${issue.options.join(", ")}` };
    case z.ZodIssueCode.invalid_string:
      return { message: "Formato no válido" };
    case z.ZodIssueCode.not_finite:
      return { message: "Debe ser un número finito" };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Campos no admitidos: ${issue.keys.join(", ")}` };
    default:
      return { message: ctx.defaultError };
  }
});
