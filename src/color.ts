// Color science: sRGB -> CIELAB (D65) and nearest-palette lookup.
// Ordered color dither matches against RGB; error-diffusion matches
// against Lab, which follows human-perceived distance more closely.

import type { RGB } from "./palettes.js";

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
  const c = v / 255;
  return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
}

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

/** Index of the nearest palette color in RGB space. */
export function nearestRGBIndex(r: number, g: number, b: number, palette: RGB[]): number {
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

const labCache = new Map<string, Lab[]>();

function cacheKey(palette: RGB[]): string {
  return palette.map((c) => c.join(",")).join(";");
}

/** Palette converted to Lab, cached per palette content. */
export function paletteToLab(palette: RGB[]): Lab[] {
  const key = cacheKey(palette);
  let lab = labCache.get(key);
  if (!lab) {
    lab = palette.map((c) => rgbToLab(c[0], c[1], c[2]));
    labCache.set(key, lab);
  }
  return lab;
}

/** Index of the nearest palette color in Lab space. */
export function nearestLabIndex(lab: Lab, paletteLab: Lab[]): number {
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
