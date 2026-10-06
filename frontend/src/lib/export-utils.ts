// Exportar paneles: CSV (para hojas de cálculo en español) y PNG (a partir del
// SVG de Recharts). Sin dependencias: todo con APIs del navegador.

export interface ExportTable {
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  // Coma decimal y `;` como separador: así Excel/Numbers en español lo abren en columnas.
  const text = typeof value === "number" ? String(Math.round(value * 100) / 100).replace(".", ",") : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: ExportTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(";"));
  // BOM para que Excel respete UTF-8 (tildes, ñ, €).
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function fileSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "grafico";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(table: ExportTable, filename: string): void {
  downloadBlob(new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" }), filename);
}

// Propiedades de estilo que Recharts deja como `var(--chart-1)` o hereda del
// CSS de la página: al sacar el SVG de la página dejarían de resolverse, así
// que se copian ya calculadas a cada elemento.
const INLINE_PROPS = [
  "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "fill-opacity", "opacity",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline",
] as const;

function inlineStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = INLINE_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(";");
  target.setAttribute("style", style);
  for (let i = 0; i < source.children.length; i += 1) {
    const child = target.children[i];
    if (child) inlineStyles(source.children[i], child);
  }
}

export function isExportableSvg(svg: Element | null): svg is SVGSVGElement {
  if (!svg) return false;
  const rect = svg.getBoundingClientRect();
  return rect.width > 80 && rect.height > 60;
}

/** Primer gráfico de Recharts del contenedor, el que tiene tamaño de gráfico (no un icono). */
export function findChartSvg(root: Element | null): SVGSVGElement | null {
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll("svg.recharts-surface"));
  return (candidates.find((svg) => isExportableSvg(svg)) as SVGSVGElement | undefined) ?? null;
}

const SCALE = 2;
const PADDING = 24;

/** Dibuja el SVG en un canvas con fondo, título y pie, y lo devuelve como PNG. */
export async function svgToPng(svg: SVGSVGElement, opts: { title: string; subtitle?: string }): Promise<Blob> {
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const xml = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo generar la imagen"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await loaded;

  const bodyStyle = getComputedStyle(document.body);
  const background = bodyStyle.getPropertyValue("--card").trim() || bodyStyle.backgroundColor || "#ffffff";
  const foreground = bodyStyle.color || "#111111";
  const headerHeight = opts.subtitle ? 62 : 44;
  const footerHeight = 28;

  const canvas = document.createElement("canvas");
  canvas.width = (width + PADDING * 2) * SCALE;
  canvas.height = (height + headerHeight + footerHeight + PADDING) * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la imagen");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = resolveColor(background);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = foreground;
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(opts.title, PADDING, PADDING * 0.75);
  if (opts.subtitle) {
    ctx.globalAlpha = 0.6;
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(opts.subtitle, PADDING, PADDING * 0.75 + 24);
    ctx.globalAlpha = 1;
  }

  ctx.drawImage(image, PADDING, headerHeight, width, height);

  ctx.globalAlpha = 0.45;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("SueldIA", PADDING, headerHeight + height + 8);
  ctx.globalAlpha = 1;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen"))), "image/png");
  });
}

/** `--card` puede estar en oklch/hsl: lo pasa por un elemento para obtener un color que el canvas entienda. */
function resolveColor(value: string): string {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || "#ffffff";
}
