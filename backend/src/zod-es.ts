import { z } from "zod";

// Mensajes de validación de Zod en español (por defecto salen en inglés y
// llegan al usuario en `details`). Los mensajes explícitos de cada esquema
// (p. ej. .positive("El importe…")) siguen mandando sobre estos.
const TYPE_NAMES: Record<string, string> = { number: "un número", string: "un texto", boolean: "sí o no", array: "una lista", object: "un objeto" };

z.config({
  customError: (issue) => {
    switch (issue.code) {
      case "invalid_type":
        if (issue.input === undefined) return "Campo obligatorio";
        // Infinity / NaN llegan como «número no válido» (Zod 4 ya no admite números infinitos).
        if (issue.expected === "number" && typeof issue.input === "number") return "Debe ser un número finito";
        return `Tipo no válido: se esperaba ${TYPE_NAMES[issue.expected] ?? issue.expected}`;
      case "too_small":
        if (issue.origin === "string") return Number(issue.minimum) === 1 ? "No puede estar vacío" : `Mínimo ${issue.minimum} caracteres`;
        if (issue.origin === "array" || issue.origin === "set") return `Mínimo ${issue.minimum} elementos`;
        return issue.inclusive ? `Debe ser mayor o igual que ${issue.minimum}` : `Debe ser mayor que ${issue.minimum}`;
      case "too_big":
        if (issue.origin === "string") return `Máximo ${issue.maximum} caracteres`;
        if (issue.origin === "array" || issue.origin === "set") return `Máximo ${issue.maximum} elementos`;
        return issue.inclusive ? `Debe ser menor o igual que ${issue.maximum}` : `Debe ser menor que ${issue.maximum}`;
      case "invalid_value":
        return `Valor no válido. Opciones: ${issue.values.map(String).join(", ")}`;
      case "invalid_format":
        return "Formato no válido";
      case "unrecognized_keys":
        return `Campos no admitidos: ${issue.keys.join(", ")}`;
      case "invalid_union":
        return "Valor no válido";
      default:
        return undefined; // el mensaje por defecto de Zod
    }
  },
});
