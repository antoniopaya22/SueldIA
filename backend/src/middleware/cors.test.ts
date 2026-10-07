import { describe, expect, it } from "vitest";
import { isOriginAllowed, requestHosts } from "./cors.js";

describe("requestHosts", () => {
  it("usa el host público del proxy y el directo", () => {
    expect(requestHosts({ headers: { "x-forwarded-host": "sueldia.vercel.app", host: "backend.internal" } })).toEqual([
      "sueldia.vercel.app",
      "backend.internal",
    ]);
  });
  it("admite varios hosts reenviados", () => {
    expect(requestHosts({ headers: { "x-forwarded-host": "a.app, b.app" } })).toEqual(["a.app", "b.app"]);
  });
});

describe("isOriginAllowed", () => {
  const hosts = ["sueldia.vercel.app", "backend.internal"];

  it("acepta peticiones sin Origin", () => {
    expect(isOriginAllowed(undefined, hosts, [])).toBe(true);
  });
  it("acepta el mismo origen aunque no esté en la lista", () => {
    expect(isOriginAllowed("https://sueldia.vercel.app", hosts, ["http://localhost:4321"])).toBe(true);
    expect(isOriginAllowed("https://SUELDIA.vercel.app", hosts, [])).toBe(true);
  });
  it("acepta los orígenes de la lista", () => {
    expect(isOriginAllowed("http://localhost:4321", hosts, ["http://localhost:4321"])).toBe(true);
  });
  it("rechaza otros orígenes", () => {
    expect(isOriginAllowed("https://evil.example", hosts, ["http://localhost:4321"])).toBe(false);
    expect(isOriginAllowed("https://sueldia.vercel.app.evil.example", hosts, [])).toBe(false);
  });
  it("rechaza un Origin mal formado", () => {
    expect(isOriginAllowed("null", hosts, [])).toBe(false);
  });
});
