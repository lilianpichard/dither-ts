// Shared kernel types.

import type { RGB } from "./palettes.js";
import { METHOD_REGISTRY, type DitherMethod } from "./methods.js";

export type { DitherMethod } from "./methods.js";

/** Single-channel image. data length = width*height, values 0..255. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Packed RGB image. data length = width*height*3, values 0..255. */
export interface RGBImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Packed RGBA image. data length = width*height*4, values 0..255. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Threshold rule shared by every B&W kernel: 255 iff value > t. */
export function quantizeBW(value: number, threshold: number): 0 | 255 {
  return value > threshold ? 255 : 0;
}

export const METHOD_NAMES: readonly DitherMethod[] = Object.freeze(
  Object.keys(METHOD_REGISTRY) as DitherMethod[],
);

/** Palette reference: registered name or explicit color list. */
export type PaletteRef = string | RGB[];

/**
 * How colour is treated. `palette` snaps every pixel to a palette member;
 * `original` dithers the source colours themselves, so the photo keeps its own
 * palette. Optional and additive: a preset without it means `palette`, which is
 * what every preset written before this field existed already did.
 */
export type ColorMode = "palette" | "original";

export type PixelMask = Uint8Array | Uint8ClampedArray;

/**
 * Row progress hook: completed rows, total rows, live output buffer and
 * its dimensions. Rows below `done` are final. The buffer is live memory:
 * copy it synchronously if posts must outlive the call.
 */
export type RowProgress = (
  done: number,
  total: number,
  out: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
) => void;

/** Options for the single pipeline entry point. */
export interface DitherOptions {
  method?: DitherMethod;
  threshold?: number;
  palette?: PaletteRef;
  /** Dither the source colours instead of snapping to `palette`. */
  colorMode?: ColorMode;
  /** Downscale-dither-upscale factor (>=1). Enlarges the visible dots. */
  pixelSize?: number;
  /** Preview mode: doubles the effective pixel size. */
  preview?: boolean;
  /** Threshold-field shift for animated ordered variation (0 = unshifted). */
  seed?: number;
  /** Nonzero bytes mark active pixels. */
  mask?: PixelMask;
  /** Called per completed row; rows below `done` are final. */
  onProgress?: RowProgress;
}

export interface DitherRGBAOptions extends DitherOptions {
  color: boolean;
}
