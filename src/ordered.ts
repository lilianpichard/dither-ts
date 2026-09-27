// Ordered dither, B&W and palette.
// B&W couples the matrix gain to the threshold: gain = 1 - t/255, so a
// threshold of 255 degrades gracefully to a plain threshold. Palette
// ordered uses a fixed 0.3 gain with RGB nearest-color matching.

import type { RGB } from "./palettes.js";
import type { OrderedMethod } from "./methods.js";
import { quantizeBW, type GrayImage, type PixelMask, type RowProgress } from "./types.js";
import { nearestRGBIndex } from "./color.js";
import { ORDERED_MATRICES, blueNoiseMask, crosshatchField } from "./matrices.js";
import {
  assertDimensions,
  assertGrayImage,
  assertMethodFamily,
  assertPalette,
  assertRGBBuffer,
  assertSeed,
  assertThreshold,
  resolveRowOrMask,
} from "./validation.js";

export const MATRIX_METHODS: readonly OrderedMethod[] = Object.keys(ORDERED_MATRICES).filter(
  (name): name is OrderedMethod => Object.hasOwn(ORDERED_MATRICES, name),
);

function seedOffset(seed: number): number {
  return ((seed % 64) + 64) % 64;
}

/** Resolve the threshold field for any ordered-family method. */
export function orderedField(method: OrderedMethod, w: number, h: number): number[][] {
  assertMethodFamily(method, "ordered");
  assertDimensions(w, h);
  if (method === "Crosshatch") return crosshatchField(w, h);
  if (method === "Blue-Noise Mask") return blueNoiseMask(h, w);
  const mat = ORDERED_MATRICES[method];
  const mh = mat.length;
  const mw = mat[0].length;
  return Array.from({ length: h }, (_, y) => {
    const src = mat[y % mh];
    return Array.from({ length: w }, (__, x) => src[x % mw]);
  });
}

/**
 * B&W ordered dither for any ordered-family method. `seed` shifts the
 * threshold field for animated variation; 0 is the unshifted reference.
 * Returns Uint8 0/255.
 */
export function orderedBW(
  img: GrayImage,
  method: OrderedMethod = "Bayer 4x4",
  threshold = 128,
  seed = 0,
  onRowOrMask?: RowProgress | PixelMask,
  mask?: PixelMask,
): Uint8Array {
  assertGrayImage(img);
  assertThreshold(threshold);
  assertSeed(seed);
  const { width: w, height: h } = img;
  const progress = resolveRowOrMask(onRowOrMask, mask, w, h);
  const activeMask = progress.mask;
  const field = orderedField(method, w, h);
  const gain = 1 - threshold / 255;
  const ox = seedOffset(seed);
  const oy = seedOffset(Math.floor(seed / 64));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (activeMask && activeMask[i] === 0) continue;
      out[i] = quantizeBW(
        img.data[i] + (field[(y + oy) % h][(x + ox) % w] - 128) * gain,
        threshold,
      );
    }
    progress.onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

/** Fixed-gain ordered dither used on the palette (color) path. */
export const PALETTE_ORDERED_GAIN = 0.3;

/**
 * Palette ordered dither on RGB input. `seed` shifts the threshold field;
 * 0 is unshifted. Returns packed RGB bytes; every pixel is a palette member.
 */
export function orderedPalette(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[],
  method: OrderedMethod = "Bayer 4x4",
  seed = 0,
  onRowOrMask?: RowProgress | PixelMask,
  mask?: PixelMask,
): Uint8ClampedArray {
  assertRGBBuffer(rgb, width, height);
  assertPalette(palette);
  assertSeed(seed);
  const progress = resolveRowOrMask(onRowOrMask, mask, width, height);
  const activeMask = progress.mask;
  const field = orderedField(method, width, height);
  const ox = seedOffset(seed);
  const oy = seedOffset(Math.floor(seed / 64));
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (activeMask && activeMask[i] === 0) continue;
      const noise = (field[(y + oy) % height][(x + ox) % width] - 128) * PALETTE_ORDERED_GAIN;
      const r = Math.min(255, Math.max(0, rgb[i * 3] + noise));
      const g = Math.min(255, Math.max(0, rgb[i * 3 + 1] + noise));
      const b = Math.min(255, Math.max(0, rgb[i * 3 + 2] + noise));
      const p = palette[nearestRGBIndex(r, g, b, palette)];
      out[i * 3] = p[0];
      out[i * 3 + 1] = p[1];
      out[i * 3 + 2] = p[2];
    }
    progress.onRow?.(y + 1, height, out, width, height);
  }
  return out;
}

/** Levels per channel the original-colour path posterises to. */
export const ORIGINAL_LEVELS = 4;

/** Spacing between those levels. */
export const ORIGINAL_STEP = 255 / (ORIGINAL_LEVELS - 1);

/** Fixed-gain ordered dither used when the source colours are kept. */
export const ORIGINAL_ORDERED_GAIN = 0.5;

/**
 * Ordered dither that keeps the source colours. Each channel is posterised to
 * `ORIGINAL_LEVELS` steps after the ordered field nudges it, and because the
 * same offset is added to all three channels the shift is a lightness move —
 * hue survives, which is the whole point of this mode. A palette dither cannot
 * say that: it replaces the pixel with a palette member.
 */
export function orderedOriginal(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  method: OrderedMethod = "Bayer 4x4",
  seed = 0,
  onRowOrMask?: RowProgress | PixelMask,
  mask?: PixelMask,
): Uint8ClampedArray {
  assertRGBBuffer(rgb, width, height);
  assertMethodFamily(method, "ordered");
  assertSeed(seed);
  const progress = resolveRowOrMask(onRowOrMask, mask, width, height);
  const activeMask = progress.mask;
  const field = orderedField(method, width, height);
  const ox = seedOffset(seed);
  const oy = seedOffset(Math.floor(seed / 64));
  const out = new Uint8ClampedArray(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (activeMask && activeMask[i] === 0) {
        out[i * 3] = rgb[i * 3];
        out[i * 3 + 1] = rgb[i * 3 + 1];
        out[i * 3 + 2] = rgb[i * 3 + 2];
        continue;
      }
      const noise = (field[(y + oy) % height][(x + ox) % width] - 128) * ORIGINAL_ORDERED_GAIN;
      for (let c = 0; c < 3; c++) {
        const v = rgb[i * 3 + c] + noise;
        out[i * 3 + c] = Math.round(Math.round(v / ORIGINAL_STEP) * ORIGINAL_STEP);
      }
    }
    progress.onRow?.(y + 1, height, out, width, height);
  }
  return out;
}
