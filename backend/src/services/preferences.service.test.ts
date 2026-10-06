import { describe, expect, it } from "vitest";
import { MAX_PREFERENCE_BYTES, isValidPreferenceKey, serializePreference } from "./preferences.service.js";

describe("isValidPreferenceKey", () => {
  it("acepta claves cortas en minúsculas con puntos, guiones y números", () => {
    for (const key of ["chart-palette", "analytics.layout", "views_2", "a"]) expect(isValidPreferenceKey(key)).toBe(true);
  });

  it("rechaza mayúsculas, espacios, barras y claves vacías o larguísimas", () => {
    for (const key of ["", "Chart", "a b", "a/b", "../x", ".oculta", "x".repeat(65)]) expect(isValidPreferenceKey(key)).toBe(false);
  });
});

describe("serializePreference", () => {
  it("serializa objetos, listas y valores simples", () => {
    expect(serializePreference({ a: [1, 2], b: "x" })).toEqual({ ok: true, json: '{"a":[1,2],"b":"x"}' });
    expect(serializePreference("brand")).toEqual({ ok: true, json: '"brand"' });
    expect(serializePreference(false)).toEqual({ ok: true, json: "false" });
    expect(serializePreference(null)).toEqual({ ok: true, json: "null" });
  });

  it("rechaza lo que no se puede guardar", () => {
    expect(serializePreference(undefined)).toMatchObject({ ok: false });
    expect(serializePreference(() => 1)).toMatchObject({ ok: false });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializePreference(circular)).toMatchObject({ ok: false });
  });

  it("rechaza valores por encima del límite, contando bytes (no caracteres)", () => {
    expect(serializePreference("x".repeat(MAX_PREFERENCE_BYTES))).toMatchObject({ ok: false });
    expect(serializePreference("x".repeat(MAX_PREFERENCE_BYTES - 10))).toMatchObject({ ok: true });
    // "ñ" ocupa 2 bytes: cabe menos de la mitad.
    expect(serializePreference("ñ".repeat(MAX_PREFERENCE_BYTES / 2))).toMatchObject({ ok: false });
  });
});
