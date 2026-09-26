// Color science: sRGB -> CIELAB (D65) and nearest-palette lookup.
// Ordered color dither matches against RGB; error-diffusion matches
// against Lab, which follows human-perceived distance more closely.

import type { RGB } from "./palettes.js";
import { assertLab, assertLabPalette, assertPalette } from "./validation.js";

export type Lab = [number, number, number];

const SRGB_TO_XYZ: readonly (readonly [number, number, number])[] = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
];
const D65_X = 0.9505;
const D65_Z = 1.089;
const LAB_EPS = 0.008856;
const LAB_KAPPA = 903.3;

function linearize(v: number): number {
  const value = Math.min(255, Math.max(0, v));
  if (Number.isInteger(value)) return LINEAR_LUT[value];
  const c = value / 255;
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}

/** Exact 256-entry table of the sRGB transfer curve (no per-pixel pow). */
const LINEAR_LUT: Float32Array = (() => {
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const c = v / 255;
    lut[v] = c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  }
  return lut;
})();

function labF(t: number): number {
  return t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

/** Convert one sRGB triple (0..255) to CIELAB. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);
  const x = (SRGB_TO_XYZ[0][0] * lr + SRGB_TO_XYZ[0][1] * lg + SRGB_TO_XYZ[0][2] * lb) / D65_X;
  const y = SRGB_TO_XYZ[1][0] * lr + SRGB_TO_XYZ[1][1] * lg + SRGB_TO_XYZ[1][2] * lb;
  const z = (SRGB_TO_XYZ[2][0] * lr + SRGB_TO_XYZ[2][1] * lg + SRGB_TO_XYZ[2][2] * lb) / D65_Z;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Squared Euclidean distance between two RGB triples. */
export function rgbDistance2(r: number, g: number, b: number, p: RGB): number {
  const dr = r - p[0];
  const dg = g - p[1];
  const db = b - p[2];
  return dr * dr + dg * dg + db * db;
}

/** Squared Euclidean distance between two Lab triples. */
export function labDistance2(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function assertRGBQuery(r: number, g: number, b: number): void {
  for (const value of [r, g, b]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 255) {
      throw new TypeError("RGB query values must be finite and between 0 and 255");
    }
  }
}

/** Index of the nearest palette color in RGB space. */
export function nearestRGBIndex(r: number, g: number, b: number, palette: RGB[]): number {
  assertRGBQuery(r, g, b);
  assertPalette(palette);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = rgbDistance2(r, g, b, palette[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const LAB_CACHE_LIMIT = 64;
const labCache = new Map<string, Lab[]>();

function cacheKey(palette: RGB[]): string {
  return palette.map((c) => c.join(",")).join(";");
}

function copyLab(lab: Lab[]): Lab[] {
  return lab.map(([l, a, b]) => [l, a, b]);
}

export function paletteToLab(palette: RGB[]): Lab[] {
  assertPalette(palette);
  const key = cacheKey(palette);
  let lab = labCache.get(key);
  if (!lab) {
    lab = palette.map((c) => rgbToLab(c[0], c[1], c[2]));
    if (labCache.size >= LAB_CACHE_LIMIT) {
      const oldest = labCache.keys().next().value;
      if (oldest !== undefined) labCache.delete(oldest);
    }
    labCache.set(key, lab);
  }
  return copyLab(lab);
}

/** Index of the nearest palette color in Lab space. */
export function nearestLabIndex(lab: Lab, paletteLab: Lab[]): number {
  assertLab(lab);
  assertLabPalette(paletteLab);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < paletteLab.length; i++) {
    const d = labDistance2(lab, paletteLab[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
