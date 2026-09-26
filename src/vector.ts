import { assertByteBuffer, assertDimensions, assertRGBBuffer } from "./validation.js";

export interface SvgRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Merge horizontal runs of `ink` value into rectangles. */
export function traceBinaryRuns(bw: Uint8Array, w: number, h: number, ink = 0): SvgRect[] {
  assertDimensions(w, h);
  assertByteBuffer(bw, w * h, "binary buffer");
  if (!Number.isInteger(ink) || ink < 0 || ink > 255) {
    throw new TypeError("ink must be an integer between 0 and 255");
  }
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
  assertRGBBuffer(rgba, w, h, 4);
  const groups = new Map<string, SvgRect[]>();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] === 0) {
        x++;
        continue;
      }
      const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
      let x1 = x + 1;
      while (x1 < w) {
        const j = (y * w + x1) * 4;
        if (
          rgba[j + 3] === 0 ||
          rgba[j + 3] !== rgba[i + 3] ||
          rgba[j] !== rgba[i] ||
          rgba[j + 1] !== rgba[i + 1] ||
          rgba[j + 2] !== rgba[i + 2]
        )
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

interface AlphaColorGroup {
  r: number;
  g: number;
  b: number;
  runs: Map<number, SvgRect[]>;
}

function traceColorRunsAlpha(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Map<string, AlphaColorGroup> {
  const groups = new Map<string, AlphaColorGroup>();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      const alpha = rgba[i + 3];
      if (alpha === 0) {
        x++;
        continue;
      }
      const key = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`;
      let x1 = x + 1;
      while (x1 < w) {
        const j = (y * w + x1) * 4;
        if (
          rgba[j + 3] !== alpha ||
          rgba[j] !== rgba[i] ||
          rgba[j + 1] !== rgba[i + 1] ||
          rgba[j + 2] !== rgba[i + 2]
        )
          break;
        x1++;
      }
      let group = groups.get(key);
      if (!group) {
        group = { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], runs: new Map() };
        groups.set(key, group);
      }
      let rects = group.runs.get(alpha);
      const rect = { x, y, w: x1 - x, h: 1 };
      if (rects) rects.push(rect);
      else group.runs.set(alpha, [rect]);
      x = x1;
    }
  }
  return groups;
}

function traceBlackRunsAlpha(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Map<number, SvgRect[]> {
  const groups = new Map<number, SvgRect[]>();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      const alpha = rgba[i + 3];
      const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (alpha === 0 || luma >= 128) {
        x++;
        continue;
      }
      let x1 = x + 1;
      while (x1 < w) {
        const j = (y * w + x1) * 4;
        const nextLuma = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
        if (rgba[j + 3] !== alpha || nextLuma >= 128) break;
        x1++;
      }
      const rect = { x, y, w: x1 - x, h: 1 };
      const rects = groups.get(alpha);
      if (rects) rects.push(rect);
      else groups.set(alpha, [rect]);
      x = x1;
    }
  }
  return groups;
}

function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&apos;";
  });
}

function rectsToSVG(rects: SvgRect[], fill: string, opacity = 1): string {
  const safeFill = esc(fill);
  const opacityAttribute = opacity < 1 ? ` fill-opacity="${opacity}"` : "";
  return rects
    .map(
      (r) =>
        `<rect x="${esc(r.x)}" y="${esc(r.y)}" width="${esc(r.w)}" height="${esc(r.h)}" fill="${safeFill}"${opacityAttribute}/>`,
    )
    .join("");
}

/** Luminance threshold: RGBA buffer to ink runs (ink = dark pixels). */
export function traceBlackVector(rgba: Uint8ClampedArray, w: number, h: number): SvgRect[] {
  assertRGBBuffer(rgba, w, h, 4);
  const bw = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const luma = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    bw[i] = rgba[i * 4 + 3] !== 0 && luma < 128 ? 0 : 255;
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

const SAFE_COLOR_NAMES = new Set([
  "black",
  "blue",
  "currentcolor",
  "cyan",
  "gray",
  "green",
  "grey",
  "magenta",
  "none",
  "red",
  "transparent",
  "white",
  "yellow",
]);

function safeColor(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a color string`);
  const color = value.trim();
  if (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ||
    SAFE_COLOR_NAMES.has(color.toLowerCase()) ||
    /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.+% -]+(?:[,/]\s*[0-9.+% -]+){2,3}\s*\)$/i.test(color)
  ) {
    return color;
  }
  throw new TypeError(`${label} must be a safe color`);
}

/** Serialize a dithered RGBA buffer to SVG. */
export function exportSVG(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  opts: SvgOptions = {},
): string {
  assertRGBBuffer(rgba, w, h, 4);
  if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
    throw new TypeError("SVG options must be an object");
  }
  if (opts.black !== undefined && typeof opts.black !== "boolean") {
    throw new TypeError("black must be a boolean");
  }
  const ink = safeColor(opts.ink ?? "#000", "ink");
  const background =
    opts.background === undefined ? undefined : safeColor(opts.background, "background");
  const bg =
    background === undefined ? "" : `<rect width="${w}" height="${h}" fill="${esc(background)}"/>`;
  let body: string;
  if (opts.black) {
    const groups = traceBlackRunsAlpha(rgba, w, h);
    body =
      bg +
      Array.from(
        groups,
        ([alpha, rects]) => `<g fill="${esc(ink)}">${rectsToSVG(rects, ink, alpha / 255)}</g>`,
      ).join("");
  } else {
    const groups = traceColorRunsAlpha(rgba, w, h);
    const parts: string[] = [];
    if (bg) parts.push(bg);
    const white = groups.get("255,255,255");
    const whiteIsOpaque =
      white !== undefined && [...white.runs.keys()].every((alpha) => alpha === 255);
    if (groups.size === 2 && groups.has("0,0,0") && whiteIsOpaque) {
      const black = groups.get("0,0,0")!;
      for (const [alpha, rects] of black.runs) {
        parts.push(`<g>${rectsToSVG(rects, ink, alpha / 255)}</g>`);
      }
    } else {
      for (const group of groups.values()) {
        const hex = `#${((group.r << 16) | (group.g << 8) | group.b).toString(16).padStart(6, "0")}`;
        for (const [alpha, rects] of group.runs) {
          parts.push(`<g>${rectsToSVG(rects, hex, alpha / 255)}</g>`);
        }
      }
    }
    body = parts.join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}
