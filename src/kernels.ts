// Original public surface: grayscale conversion plus the first two
// diffusion kernels, now delegated to the table engine.

import type { GrayImage } from "./types.js";
import { diffuseBW } from "./diffusion.js";

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

/** Floyd-Steinberg B&W. Rule: new = 255 iff old > t. */
export function floydSteinberg(img: GrayImage, threshold = 128): Uint8Array {
  return diffuseBW(img, "Floyd-Steinberg", threshold);
}

/** Atkinson B&W. Error spread = 1/8 to 6 neighbours. */
export function atkinson(img: GrayImage, threshold = 128): Uint8Array {
  return diffuseBW(img, "Atkinson", threshold);
}
