// SVG export: trace dithered buffers into merged horizontal runs,
// emitted as <rect> elements. B&W yields one ink group; color yields
// one group per palette color. Black-vector mode keeps ink only.

export interface SvgRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Merge horizontal runs of `ink` value into rectangles. */
export function traceBinaryRuns(bw: Uint8Array, w: number, h: number, ink = 0): SvgRect[] {
  const rects: SvgRect[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (bw[y * w + x] !== ink) {
        x++;
        continue;
      }
      let x1 = x + 1;
      while (x1 < w && bw[y * w + x1] === ink) x1++;
      rects.push({ x, y, w: x1 - x, h: 1 });
      x = x1;
    }
  }
  return rects;
}

/** Merge horizontal runs per distinct RGB color. Key is "r,g,b". */
export function traceColorRuns(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Map<string, SvgRect[]> {
  const groups = new Map<string, SvgRect[]>();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
      let x1 = x + 1;
      while (x1 < w) {
        const j = (y * w + x1) * 4;
        if (rgba[j] !== rgba[i] || rgba[j + 1] !== rgba[i + 1] || rgba[j + 2] !== rgba[i + 2])
          break;
        x1++;
      }
      const list = groups.get(key);
      const rect = { x, y, w: x1 - x, h: 1 };
      if (list) list.push(rect);
      else groups.set(key, [rect]);
      x = x1;
    }
  }
  return groups;
}

function esc(n: number): string {
  return String(n);
}

function rectsToSVG(rects: SvgRect[], fill: string): string {
  return rects
    .map(
      (r) =>
        `<rect x="${esc(r.x)}" y="${esc(r.y)}" width="${esc(r.w)}" height="${esc(r.h)}" fill="${fill}"/>`,
    )
    .join("");
}

/** Luminance threshold: RGBA buffer to ink runs (ink = dark pixels). */
export function traceBlackVector(rgba: Uint8ClampedArray, w: number, h: number): SvgRect[] {
  const bw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const luma = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    bw[i] = luma < 128 ? 0 : 255;
  }
  return traceBinaryRuns(bw, w, h, 0);
}

export interface SvgOptions {
  /** Single-ink output for print/embroidery/vinyl. */
  black?: boolean;
  /** Ink fill for B&W / black-vector output. */
  ink?: string;
  /** Canvas background (omitted = transparent). */
  background?: string;
}

/**
 * Serialize a dithered RGBA buffer to SVG. Color mode groups runs per
 * color; B&W buffers collapse to one ink group; `black` forces
 * single-ink tracing for print workflows.
 */
export function exportSVG(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opts: SvgOptions = {},
): string {
  const ink = opts.ink ?? "#000";
  const bg = opts.background ? `<rect width="${w}" height="${h}" fill="${opts.background}"/>` : "";
  let body: string;
  if (opts.black) {
    body = bg + `<g fill="${ink}">${rectsToSVG(traceBlackVector(rgba, w, h), ink)}</g>`;
  } else {
    const groups = traceColorRuns(rgba, w, h);
    const parts: string[] = [];
    if (bg) parts.push(bg);
    if (groups.size === 2 && groups.has("0,0,0") && groups.has("255,255,255")) {
      parts.push(`<g>${rectsToSVG(groups.get("0,0,0")!, ink)}</g>`);
    } else {
      for (const [key, rects] of groups) {
        const [r, g, b] = key.split(",").map(Number);
        const hex = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
        parts.push(`<g>${rectsToSVG(rects, hex)}</g>`);
      }
    }
    body = parts.join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}
