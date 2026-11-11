import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "./base64url";

describe("base64UrlToBytes", () => {
  it("decodifica base64url sin relleno", () => {
    expect([...base64UrlToBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
    expect([...base64UrlToBytes("")]).toEqual([]);
  });
});
