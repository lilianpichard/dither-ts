// Error-diffusion kernels: one table-driven engine plus the special
// scans that need per-pixel weights, serpentine order, or row snapshots.

import type { RGB } from "./palettes.js";
import { quantizeBW, type GrayImage } from "./types.js";
import { nearestLabIndex, paletteToLab, rgbToLab } from "./color.js";
import { tileMatrix, DOT_CLASS } from "./matrices.js";

/** One error tap: row offset, column offset, share of the error. */
export type DiffusionTap = readonly [dy: number, dx: number, weight: number];

/** Error-share tables. Weights are written as fractions for readability. */
export const DIFFUSION_TABLES: Record<string, DiffusionTap[]> = {
  "Floyd-Steinberg": [
    [0, 1, 7 / 16],
    [1, -1, 3 / 16],
    [1, 0, 5 / 16],
    [1, 1, 1 / 16],
  ],
  Atkinson: [
    [0, 1, 1 / 8],
    [0, 2, 1 / 8],
    [1, -1, 1 / 8],
    [1, 0, 1 / 8],
    [1, 1, 1 / 8],
    [2, 0, 1 / 8],
  ],
  Sierra: [
    [0, 1, 5 / 32],
    [0, 2, 3 / 32],
    [1, -2, 2 / 32],
    [1, -1, 4 / 32],
    [1, 0, 5 / 32],
    [1, 1, 4 / 32],
    [1, 2, 2 / 32],
    [2, -1, 2 / 32],
    [2, 0, 3 / 32],
    [2, 1, 2 / 32],
  ],
  "Sierra-Lite": [
    [0, 1, 1 / 2],
    [1, -1, 1 / 4],
    [1, 0, 1 / 4],
  ],
  "Jarvis-Judice-Ninke": [
    [0, 1, 7 / 48],
    [0, 2, 5 / 48],
    [1, -2, 3 / 48],
    [1, -1, 5 / 48],
    [1, 0, 7 / 48],
    [1, 1, 5 / 48],
    [1, 2, 3 / 48],
    [2, -2, 1 / 48],
    [2, -1, 3 / 48],
    [2, 0, 5 / 48],
    [2, 1, 3 / 48],
    [2, 2, 1 / 48],
  ],
  Stucki: [
    [0, 1, 8 / 42],
    [0, 2, 4 / 42],
    [1, -2, 2 / 42],
    [1, -1, 4 / 42],
    [1, 0, 8 / 42],
    [1, 1, 4 / 42],
    [1, 2, 2 / 42],
    [2, -2, 1 / 42],
    [2, -1, 2 / 42],
    [2, 0, 4 / 42],
    [2, 1, 2 / 42],
    [2, 2, 1 / 42],
  ],
  Nakano: [
    [0, 1, 8 / 24],
    [1, -1, 4 / 24],
    [1, 0, 4 / 24],
    [1, 1, 4 / 24],
    [2, -2, 1 / 24],
    [2, -1, 2 / 24],
    [2, 0, 1 / 24],
  ],
  Burkes: [
    [0, 1, 8 / 32],
    [0, 2, 4 / 32],
    [1, -2, 2 / 32],
    [1, -1, 4 / 32],
    [1, 0, 8 / 32],
    [1, 1, 4 / 32],
    [1, 2, 2 / 32],
  ],
  "Stevenson-Arce": [
    [0, 2, 32 / 200],
    [1, -3, 12 / 200],
    [1, -1, 26 / 200],
    [1, 1, 30 / 200],
    [1, 3, 16 / 200],
    [2, -2, 12 / 200],
    [2, 0, 26 / 200],
    [2, 2, 12 / 200],
    [3, -3, 5 / 200],
    [3, -1, 12 / 200],
    [3, 1, 12 / 200],
    [3, 3, 5 / 200],
  ],
};

/**
 * Generic B&W error-diffusion. Unknown names fall back to Floyd-Steinberg.
 * Accumulator is unclamped; out-of-bounds taps are skipped. Returns 0/255.
 */
export function diffuseBW(img: GrayImage, kernel: string, threshold = 128): Uint8Array {
  const taps = DIFFUSION_TABLES[kernel] ?? DIFFUSION_TABLES["Floyd-Steinberg"];
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = a[i];
      const nv = quantizeBW(old, threshold);
      out[i] = nv;
      const e = old - nv;
      for (const [dy, dx, wt] of taps) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny >= 0 && ny < h && nx >= 0 && nx < w) a[ny * w + nx] += e * wt;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Special scans
// ---------------------------------------------------------------------------

/** Band table: [right, down-left, down, divisor] per 8-gray band. */
const OSTROMOUKHOV_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [13, 0, 5, 18],
  [13, 0, 5, 18],
  [21, 0, 10, 31],
  [7, 0, 4, 11],
  [8, 0, 5, 13],
  [47, 3, 28, 78],
  [23, 3, 13, 39],
  [15, 3, 8, 26],
  [22, 5, 10, 37],
  [56, 14, 21, 91],
  [28, 8, 9, 45],
  [19, 6, 5, 30],
  [14, 5, 3, 22],
  [7, 3, 1, 11],
  [65, 32, 7, 104],
  [23, 12, 2, 37],
  [23, 12, 2, 37],
  [65, 32, 7, 104],
  [7, 3, 1, 11],
  [14, 5, 3, 22],
  [19, 6, 5, 30],
  [28, 8, 9, 45],
  [56, 14, 21, 91],
  [22, 5, 10, 37],
  [15, 3, 8, 26],
  [23, 3, 13, 39],
  [47, 3, 28, 78],
  [8, 0, 5, 13],
  [7, 0, 4, 11],
  [21, 0, 10, 31],
  [13, 0, 5, 18],
  [13, 0, 5, 18],
];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Error shares picked per-pixel from the band of the current value. */
export function ostromoukhovBW(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = a[i];
      const nv = quantizeBW(old, threshold);
      out[i] = nv;
      a[i] = nv;
      const band = Math.min(31, Math.max(0, Math.floor(old / 8)));
      const [c0, c1, c2, dn] = OSTROMOUKHOV_TABLE[band];
      if (dn === 0) continue;
      const e = old - nv;
      if (x + 1 < w) a[i + 1] = clamp255(a[i + 1] + (e * c0) / dn);
      if (y + 1 < h) {
        if (x > 0) a[i + w - 1] = clamp255(a[i + w - 1] + (e * c1) / dn);
        a[i + w] = clamp255(a[i + w] + (e * c2) / dn);
      }
    }
  }
  return out;
}

/**
 * Floyd-Steinberg shares scaled by local brightness: rightward taps use
 * f = v/255, down-left uses (1-f). Border columns and the last row keep
 * their unquantized (clipped) values.
 */
export function variableErrorBW(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  const done = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    const n = Math.max(0, w - 2);
    const row = new Float32Array(n);
    for (let k = 0; k < n; k++) row[k] = a[y * w + 1 + k];
    const nw = new Uint8Array(n);
    for (let k = 0; k < n; k++) nw[k] = quantizeBW(row[k], threshold);
    for (let k = 0; k < n; k++) {
      const e = row[k] - nw[k];
      const f = row[k] / 255;
      const x = 1 + k;
      a[y * w + x + 1] = clamp255(a[y * w + x + 1] + (e * 7 * f) / 16);
      a[(y + 1) * w + x - 1] = clamp255(a[(y + 1) * w + x - 1] + (e * 3 * (1 - f)) / 16);
      a[(y + 1) * w + x] = clamp255(a[(y + 1) * w + x] + (e * 5) / 16);
      a[(y + 1) * w + x + 1] = clamp255(a[(y + 1) * w + x + 1] + e / 16);
    }
    for (let k = 0; k < n; k++) {
      out[y * w + 1 + k] = nw[k];
      a[y * w + 1 + k] = nw[k];
      done[y * w + 1 + k] = 1;
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!done[i]) out[i] = quantizeBW(clamp255(a[i]), threshold);
  }
  return out;
}

/**
 * Class-weighted rightward spread. The spread row is overwritten by the
 * quantized row, so the output equals a plain threshold by construction.
 */
export function dotDiffusionBW(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const dc = tileMatrix(DOT_CLASS, h, w);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = new Float32Array(w);
    for (let x = 0; x < w; x++) row[x] = a[y * w + x];
    const nw = new Uint8Array(w);
    for (let x = 0; x < w; x++) nw[x] = quantizeBW(row[x], threshold);
    if (w > 1) {
      for (let x = 0; x < w - 1; x++) {
        a[y * w + x + 1] = clamp255(a[y * w + x + 1] + (row[x] - nw[x]) / (dc[y][x] + 1));
      }
    }
    for (let x = 0; x < w; x++) {
      out[y * w + x] = nw[x];
      a[y * w + x] = nw[x];
    }
  }
  return out;
}

/** Serpentine scan with a 16-slot error queue (decay 1/16 per step). */
export function riemersmaBW(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  const buf: number[] = Array.from({ length: 16 }, () => 0);
  const decay = 0.0625;
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const i = y * w + x;
      const old = a[i] + buf[0];
      const nv = quantizeBW(old, threshold);
      out[i] = nv;
      a[i] = nv;
      buf.shift();
      buf.push((old - nv) * decay);
    }
  }
  return out;
}

/** Special-scan dispatch (non-table kernels). */
export const SPECIAL_DIFFUSION: Record<string, (img: GrayImage, t: number) => Uint8Array> = {
  Ostromoukhov: ostromoukhovBW,
  "Variable-Error": variableErrorBW,
  "Dot-Diffusion": dotDiffusionBW,
  Riemersma: riemersmaBW,
};

// ---------------------------------------------------------------------------
// Color error-diffusion (Lab nearest, clipped accumulator)
// ---------------------------------------------------------------------------

/**
 * Palette error-diffusion on RGB input. The accumulator is clipped to
 * 0..255 on every spread. Unknown methods fall back to Floyd-Steinberg.
 * Returns packed RGB bytes; every pixel is a palette member.
 */
export function diffusePalette(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[],
  method = "Floyd-Steinberg",
): Uint8ClampedArray {
  const taps = DIFFUSION_TABLES[method] ?? DIFFUSION_TABLES["Floyd-Steinberg"];
  const palLab = paletteToLab(palette);
  const a = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) a[i] = rgb[i];
  const out = new Uint8ClampedArray(rgb.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const lab = rgbToLab(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      const p = palette[nearestLabIndex(lab, palLab)];
      out[i * 3] = p[0];
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = p[2];
      const er = a[i * 3] - p[0];
      const eg = a[i * 3 + 1] - p[1];
      const eb = a[i * 3 + 2] - p[2];
      for (const [dy, dx, wt] of taps) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
          const j = (ny * width + nx) * 3;
          a[j] = clamp255(a[j] + er * wt);
          a[j + 1] = clamp255(a[j + 1] + eg * wt);
          a[j + 2] = clamp255(a[j + 2] + eb * wt);
        }
      }
    }
  }
  return out;
}
