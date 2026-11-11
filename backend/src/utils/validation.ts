import { z } from "zod";

// Límites comunes para lo que entra por la API. Zod 3 acepta Infinity como
// número (y JSON.parse("1e999") lo produce): un importe infinito se guardaba,
// las sumas pasaban a Infinity y la respuesta JSON lo convertía en null,
// dejando saldos y presupuesto rotos sin forma de arreglarlos desde la app.
const MAX_MONEY = 1_000_000_000;

/** Importe con signo, finito y acotado. */
export const moneySchema = z.number().finite("Importe no válido").min(-MAX_MONEY).max(MAX_MONEY);

/** Importe mayor que cero, finito y acotado. */
export const positiveMoneySchema = (message = "El importe debe ser mayor que cero") =>
  z.number().finite("Importe no válido").positive(message).max(MAX_MONEY);

/** Id de una fila (serial de Postgres: int4). Fuera de rango daba 500 en vez de 400. */
export const idSchema = z.number().int().positive().max(2_147_483_647);
