// Dither kernels.

import { ORDERED_MATRICES, BAYER_4x4 } from "./matrices.js";
import type { RGB } from "./palettes.js";

export interface GrayImage {
  width: number;
  height: number;
  /** length = width*height, values 0..255 */
  data: Float32Array;
}

export function grayscaleFromRGB(rgb: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    data[i] = 0.299 * r + 0.587 * g + 0.114 * b; // luma
  }
  return { width, height, data };
}

/** B&W ordered dither. Returns Uint8 0/255 per pixel. */
export function orderedBW(img: GrayImage, matrixName = "Bayer 4x4", threshold = 128): Uint8Array {
  const mat = ORDERED_MATRICES[matrixName] ?? BAYER_4x4;
  const mh = mat.length;
  const mw = mat[0].length;
  const out = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      const noise = (mat[y % mh][x % mw] - 128.0) * 0.3;
      out[i] = img.data[i] + noise > threshold ? 255 : 0;
    }
  }
  return out;
}

function nearestRGBIndex(r: number, g: number, b: number, pal: RGB[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const dr = r - pal[i][0];
    const dg = g - pal[i][1];
    const db = b - pal[i][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Palette ordered dither on RGB input. Returns packed RGB bytes. */
export function orderedPalette(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[],
  matrixName = "Bayer 4x4",
): Uint8ClampedArray {
  const mat = ORDERED_MATRICES[matrixName] ?? BAYER_4x4;
  const mh = mat.length;
  const mw = mat[0].length;
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const noise = (mat[y % mh][x % mw] - 128.0) * 0.3;
      const r = Math.min(255, Math.max(0, rgb[i * 3] + noise));
      const g = Math.min(255, Math.max(0, rgb[i * 3 + 1] + noise));
      const b = Math.min(255, Math.max(0, rgb[i * 3 + 2] + noise));
      const p = palette[nearestRGBIndex(r, g, b, palette)];
      out[i * 3] = p[0];
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = p[2];
    }
  }
  return out;
}

/** Floyd-Steinberg B&W. Mutates a copy. Rule: new = 255 iff old > t. */
export function floydSteinberg(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = a[i];
      const nv = old > threshold ? 255 : 0;
      out[i] = nv;
      const e = old - nv;
      if (x + 1 < w) a[i + 1] += e * (7 / 16);
      if (y + 1 < h) {
        if (x > 0) a[i + w - 1] += e * (3 / 16);
        a[i + w] += e * (5 / 16);
        if (x + 1 < w) a[i + w + 1] += e * (1 / 16);
      }
    }
  }
  return out;
}

/** Atkinson B&W. Error spread = (old-new)*1/8 to 6 neighbours. */
export function atkinson(img: GrayImage, threshold = 128): Uint8Array {
  const { width: w, height: h } = img;
  const a = Float32Array.from(img.data);
  const out = new Uint8Array(w * h);
  const at = (yy: number, xx: number, v: number) => {
    if (yy >= 0 && yy < h && xx >= 0 && xx < w) a[yy * w + xx] += v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = a[i];
      const nv = old > threshold ? 255 : 0;
      out[i] = nv;
      const e = (old - nv) * (1 / 8);
      at(y, x + 1, e);
      at(y, x + 2, e);
      at(y + 1, x - 1, e);
      at(y + 1, x, e);
      at(y + 1, x + 1, e);
      at(y + 2, x, e);
    }
  }
  return out;
}
