// Ordered dither, B&W and palette.
// B&W couples the matrix gain to the threshold: gain = 1 - t/255, so a
// threshold of 255 degrades gracefully to a plain threshold. Palette
// ordered uses a fixed 0.3 gain with RGB nearest-color matching.

import type { RGB } from "./palettes.js";
import { quantizeBW, type GrayImage } from "./types.js";
import { nearestRGBIndex } from "./color.js";
import { BAYER_4x4, ORDERED_MATRICES, blueNoiseMask, crosshatchField } from "./matrices.js";

/** Names served by the static matrix registry. */
export const MATRIX_METHODS: readonly string[] = Object.keys(ORDERED_MATRICES);

/** Resolve the threshold field for any ordered-family method. */
export function orderedField(method: string, w: number, h: number): number[][] {
  if (method === "Crosshatch") return crosshatchField(w, h);
  if (method === "Blue-Noise Mask") return blueNoiseMask(h, w);
  const mat = ORDERED_MATRICES[method] ?? BAYER_4x4;
  const mh = mat.length;
  const mw = mat[0].length;
  return Array.from({ length: h }, (_, y) => {
    const src = mat[y % mh];
    return Array.from({ length: w }, (__, x) => src[x % mw]);
  });
}

/**
 * B&W ordered dither for any ordered-family method. Unknown names fall
 * back to Bayer 4x4. `seed` shifts the threshold field for animated
 * variation; 0 is the unshifted reference. Returns Uint8 0/255.
 */
export function orderedBW(
  img: GrayImage,
  method = "Bayer 4x4",
  threshold = 128,
  seed = 0,
): Uint8Array {
  const { width: w, height: h } = img;
  const field = orderedField(method, w, h);
  const gain = 1 - threshold / 255;
  const ox = seed % 64;
  const oy = Math.floor(seed / 64) % 64;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = quantizeBW(
        img.data[i] + (field[(y + oy) % h][(x + ox) % w] - 128) * gain,
        threshold,
      );
    }
  }
  return out;
}

/** Fixed-gain ordered dither used on the palette (color) path. */
export const PALETTE_ORDERED_GAIN = 0.3;

/**
 * Palette ordered dither on RGB input. Unknown methods fall back to
 * Bayer 4x4. `seed` shifts the threshold field; 0 is unshifted.
 * Returns packed RGB bytes; every pixel is a palette member.
 */
export function orderedPalette(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[],
  method = "Bayer 4x4",
  seed = 0,
): Uint8ClampedArray {
  const field = orderedField(method, width, height);
  const ox = seed % 64;
  const oy = Math.floor(seed / 64) % 64;
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const noise = (field[(y + oy) % height][(x + ox) % width] - 128) * PALETTE_ORDERED_GAIN;
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
