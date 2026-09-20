// Single pipeline entry point: method routing, threshold, palette,
// downscale-dither-upscale (pixel size) and preview scaling.

import { PALETTES, type RGB } from "./palettes.js";
import { quantizeBW, type DitherOptions, type GrayImage } from "./types.js";
import { DIFFUSION_TABLES, SPECIAL_DIFFUSION, diffuseBW, diffusePalette } from "./diffusion.js";
import { MATRIX_METHODS, orderedBW, orderedPalette } from "./ordered.js";

const ORDERED_SET = new Set<string>([...MATRIX_METHODS, "Crosshatch", "Blue-Noise Mask"]);
const TABLE_SET = new Set<string>(Object.keys(DIFFUSION_TABLES));
const SPECIAL_SET = new Set<string>(Object.keys(SPECIAL_DIFFUSION));

/** True for B&W-only palettes (the two-color black/white set). */
export function isBWPalette(palette: RGB[]): boolean {
  return palette.length === 2 && palette[0][0] === 0 && palette[1][0] === 255;
}

/** Resolve a palette reference to an explicit color list. */
export function resolvePalette(ref: NonNullable<DitherOptions["palette"]>): RGB[] {
  if (typeof ref === "string") return PALETTES[ref] ?? PALETTES["B&W"];
  return ref.length >= 2 ? ref : PALETTES["B&W"];
}

/** Default palette: black and white. */
export const DEFAULT_PALETTE: RGB[] = PALETTES["B&W"];

/** Effective pixel factor: pixelSize, doubled in preview mode. */
export function effectivePixelSize(pixelSize = 1, preview = false): number {
  return Math.max(1, Math.floor(pixelSize) * (preview ? 2 : 1));
}

/** Nearest downscale by integer factor (top-left sample per block). */
export function downscaleGray(img: GrayImage, factor: number): GrayImage {
  if (factor <= 1) return img;
  const w = Math.max(1, Math.floor(img.width / factor));
  const h = Math.max(1, Math.floor(img.height / factor));
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] =
        img.data[
          Math.min(img.height - 1, y * factor) * img.width + Math.min(img.width - 1, x * factor)
        ];
    }
  }
  return { width: w, height: h, data };
}

/** Nearest upscale back to w x h (pixel repeat). */
export function upscaleBW(
  small: Uint8Array,
  sw: number,
  sh: number,
  w: number,
  h: number,
): Uint8Array {
  if (sw === w && sh === h) return small;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] =
        small[
          Math.min(sh - 1, Math.floor((y * sh) / h)) * sw +
            Math.min(sw - 1, Math.floor((x * sw) / w))
        ];
    }
  }
  return out;
}

/** Plain threshold without diffusion (fallback for unknown methods). */
export function thresholdBW(img: GrayImage, threshold: number): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = quantizeBW(img.data[i], threshold);
  return out;
}

/**
 * Dither a grayscale image. Routes to passthrough, ordered,
 * error-diffusion, or plain threshold by method name. Applies
 * pixel-size scaling around the core.
 */
export function ditherGray(img: GrayImage, options: DitherOptions = {}): Uint8Array {
  const method = options.method ?? "Floyd-Steinberg";
  const threshold = options.threshold ?? 128;
  const seed = options.seed ?? 0;
  const factor = effectivePixelSize(options.pixelSize, options.preview);
  const small = downscaleGray(img, factor);
  let out: Uint8Array;
  if (method === "None") {
    out = new Uint8Array(small.width * small.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.min(255, Math.max(0, Math.round(small.data[i])));
    }
  } else if (ORDERED_SET.has(method)) {
    out = orderedBW(small, method, threshold, seed);
  } else if (TABLE_SET.has(method)) {
    out = diffuseBW(small, method, threshold);
  } else if (SPECIAL_SET.has(method)) {
    out = SPECIAL_DIFFUSION[method](small, threshold);
  } else {
    out = thresholdBW(small, threshold);
  }
  return upscaleBW(out, small.width, small.height, img.width, img.height);
}

function downscaleRGB(
  rgb: Uint8ClampedArray,
  w: number,
  h: number,
  factor: number,
): { data: Uint8ClampedArray; w: number; h: number } {
  if (factor <= 1) return { data: rgb, w, h };
  const sw = Math.max(1, Math.floor(w / factor));
  const sh = Math.max(1, Math.floor(h / factor));
  const data = new Uint8ClampedArray(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (Math.min(h - 1, y * factor) * w + Math.min(w - 1, x * factor)) * 3;
      const d = (y * sw + x) * 3;
      data[d] = rgb[s];
      data[d + 1] = rgb[s + 1];
      data[d + 2] = rgb[s + 2];
    }
  }
  return { data, w: sw, h: sh };
}

function upscaleRGB(
  small: Uint8ClampedArray,
  sw: number,
  sh: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  if (sw === w && sh === h) return small;
  const out = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s =
        (Math.min(sh - 1, Math.floor((y * sh) / h)) * sw +
          Math.min(sw - 1, Math.floor((x * sw) / w))) *
        3;
      const d = (y * w + x) * 3;
      out[d] = small[s];
      out[d + 1] = small[s + 1];
      out[d + 2] = small[s + 2];
    }
  }
  return out;
}

/**
 * Dither an RGB image against a palette. "None" passes the pixels
 * through untouched; ordered methods use the fixed-gain ordered path;
 * diffusion methods use Lab error-diffusion; unknown methods fall back
 * to Floyd-Steinberg.
 */
export function ditherColor(
  rgb: Uint8ClampedArray,
  width: number,
  height: number,
  options: DitherOptions = {},
): Uint8ClampedArray {
  const method = options.method ?? "Floyd-Steinberg";
  const palette = resolvePalette(options.palette ?? DEFAULT_PALETTE);
  const seed = options.seed ?? 0;
  const factor = effectivePixelSize(options.pixelSize, options.preview);
  const small = downscaleRGB(rgb, width, height, factor);
  if (method === "None") {
    return upscaleRGB(small.data.slice(), small.w, small.h, width, height);
  }
  const out = ORDERED_SET.has(method)
    ? orderedPalette(small.data, small.w, small.h, palette, method, seed)
    : diffusePalette(small.data, small.w, small.h, palette, method);
  return upscaleRGB(out, small.w, small.h, width, height);
}
