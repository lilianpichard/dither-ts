// Shared kernel types.

import type { RGB } from "./palettes.js";

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

/** Threshold rule shared by every B&W kernel: 255 iff value > t. */
export function quantizeBW(value: number, threshold: number): 0 | 255 {
  return value > threshold ? 255 : 0;
}

/** All dither method names, in stable display order. "None" passes through. */
export const METHOD_NAMES: readonly string[] = [
  "None",
  "Bayer 2x2",
  "Bayer 4x4",
  "Bayer 8x8",
  "Clustered-Dot",
  "Halftone",
  "Blue-Noise",
  "Void-and-Cluster",
  "Pattern",
  "Crosshatch",
  "Floyd-Steinberg",
  "Atkinson",
  "Sierra",
  "Sierra-Lite",
  "Jarvis-Judice-Ninke",
  "Stucki",
  "Nakano",
  "Burkes",
  "Stevenson-Arce",
  "Ostromoukhov",
  "Variable-Error",
  "Dot-Diffusion",
  "Riemersma",
  "Blue-Noise Mask",
];

/** Palette reference: registered name or explicit color list. */
export type PaletteRef = string | RGB[];

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
  method?: string;
  threshold?: number;
  palette?: PaletteRef;
  /** Downscale-dither-upscale factor (>=1). Enlarges the visible dots. */
  pixelSize?: number;
  /** Preview mode: doubles the effective pixel size. */
  preview?: boolean;
  /** Threshold-field shift for animated ordered variation (0 = unshifted). */
  seed?: number;
  /** Called per completed row; rows below `done` are final. */
  onProgress?: RowProgress;
}
