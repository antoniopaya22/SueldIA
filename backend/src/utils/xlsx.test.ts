import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, excelDate, toXlsx, zip } from "./xlsx.js";

/** Lee un zip (sin data descriptors) y comprueba el CRC de cada fichero. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const crc = buf.readUInt32LE(p + 14);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const start = p + 30 + nameLen + extraLen;
    const data = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString("utf8");
    p = start + size;
  }
  return out;
}

describe("xlsx", () => {
  it("crc32 conocido", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("fechas como número de serie de Excel", () => {
    expect(excelDate("1900-03-01")).toBe(61);
    expect(excelDate("2026-03-01")).toBe(46082);
    expect(excelDate("no")).toBeNull();
  });

  it("zip legible con sus ficheros", () => {
    const files = unzip(zip([["a.txt", "hola"], ["b/ñ.xml", "<x/>"]]));
    expect(files).toEqual({ "a.txt": "hola", "b/ñ.xml": "<x/>" });
  });

  it("hoja con tipos: fechas, euros y textos escapados (nunca fórmulas)", () => {
    const files = unzip(toXlsx("Movimientos", [
      { header: "Fecha", type: "date" }, { header: "Beneficiario" }, { header: "Importe", type: "money" },
    ], [["2026-03-01", "=HYPERLINK(\"x\") & <b>", -45.3], [null, null, null]]));
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain('<c r="A2" s="3"><v>46082</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>-45.3</v></c>');
    expect(sheet).toContain("=HYPERLINK(&quot;x&quot;) &amp; &lt;b&gt;");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('state="frozen"');
    expect(files["xl/workbook.xml"]).toContain('name="Movimientos"');
  });
});
