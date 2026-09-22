// Ordered dither matrices (0..255).

import { mulberry32 } from "./prng.js";
export const BAYER_2x2: number[][] = [
  [0, 192],
  [128, 64],
];

export const BAYER_4x4: number[][] = [
  [0, 128, 32, 160],
  [192, 64, 224, 96],
  [48, 176, 16, 144],
  [240, 112, 208, 80],
];

export const BAYER_8x8: number[][] = [
  [0, 128, 32, 160, 8, 136, 40, 168],
  [192, 64, 224, 96, 200, 72, 232, 104],
  [48, 176, 16, 144, 56, 184, 24, 152],
  [240, 112, 208, 80, 248, 120, 216, 88],
  [12, 140, 44, 172, 4, 132, 36, 164],
  [204, 76, 236, 108, 196, 68, 228, 100],
  [60, 188, 28, 156, 52, 180, 20, 148],
  [252, 124, 220, 92, 244, 116, 212, 84],
];

const SCALE_16 = 255.0 / 16.0;
export const CLUSTER_4x4: number[][] = [
  [12, 5, 6, 13],
  [4, 0, 1, 7],
  [11, 3, 2, 8],
  [15, 10, 9, 14],
].map((row) => row.map((v) => v * SCALE_16));

const SCALE_17 = 255.0 / 17.0;
export const HALFTONE_4x4: number[][] = [
  [7, 13, 11, 4],
  [12, 16, 14, 8],
  [10, 15, 6, 2],
  [5, 9, 3, 1],
].map((row) => row.map((v) => v * SCALE_17));

export const PATTERN_8x8: number[][] = Array.from({ length: 8 }, (_, i) =>
  Array.from({ length: 8 }, (__, j) => ((i + j) % 8) * 32.0),
);

export const BLUE_NOISE_8x8: number[][] = [
  [0.938, 0.25, 0.688, 0.063, 0.875, 0.188, 0.625, 0.125],
  [0.375, 0.813, 0.5, 0.938, 0.313, 0.75, 0.438, 0.563],
  [0.688, 0.125, 0.875, 0.25, 0.625, 0.063, 0.938, 0.188],
  [0.188, 0.625, 0.063, 0.75, 0.125, 0.5, 0.25, 0.813],
  [0.813, 0.438, 0.563, 0.375, 0.875, 0.313, 0.688, 0.063],
  [0.313, 0.938, 0.188, 0.813, 0.063, 0.938, 0.125, 0.563],
  [0.563, 0.063, 0.75, 0.438, 0.563, 0.375, 0.813, 0.313],
  [0.063, 0.5, 0.313, 0.875, 0.25, 0.688, 0.438, 0.75],
].map((row) => row.map((v) => v * 255.0));

export const VOID_CLUSTER_8x8: number[][] = [
  [3, 200, 56, 168, 24, 216, 72, 184],
  [136, 88, 240, 104, 152, 40, 248, 120],
  [48, 176, 16, 224, 64, 192, 8, 160],
  [208, 80, 144, 32, 232, 96, 128, 16],
  [28, 228, 60, 172, 4, 204, 52, 180],
  [164, 44, 252, 116, 140, 68, 236, 108],
  [76, 196, 20, 148, 84, 212, 36, 156],
  [220, 92, 132, 12, 244, 124, 100, 68],
];

export const ORDERED_MATRICES: Record<string, number[][]> = {
  "Bayer 2x2": BAYER_2x2,
  "Bayer 4x4": BAYER_4x4,
  "Bayer 8x8": BAYER_8x8,
  "Clustered-Dot": CLUSTER_4x4,
  Halftone: HALFTONE_4x4,
  "Blue-Noise": BLUE_NOISE_8x8,
  "Void-and-Cluster": VOID_CLUSTER_8x8,
  Pattern: PATTERN_8x8,
};

/** Tile a small matrix to h x w. */
export function tileMatrix(matrix: number[][], h: number, w: number): number[][] {
  const mh = matrix.length;
  const mw = matrix[0].length;
  return Array.from({ length: h }, (_, y) => {
    const src = matrix[y % mh];
    return Array.from({ length: w }, (__, x) => src[x % mw]);
  });
}

/** Class matrix for dot-diffusion, tiled to h x w. */
export const DOT_CLASS: number[][] = [
  [0, 2, 4, 6],
  [1, 3, 5, 7],
  [0, 2, 4, 6],
  [1, 3, 5, 7],
];

const crosshatchCache = new Map<string, number[][]>();

/** Procedural crosshatch field (0..255) for w*h. Cached per size. */
export function crosshatchField(w: number, h: number): number[][] {
  const key = `${w}x${h}`;
  const hit = crosshatchCache.get(key);
  if (hit) return hit;
  const field = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (__, x) => (Math.sin(x * 0.5) + Math.sin(y * 0.5)) * 64 + 128),
  );
  if (crosshatchCache.size >= 8) crosshatchCache.clear();
  crosshatchCache.set(key, field);
  return field;
}

const MASK_SIZE = 64;
const MASK_SEED = 0xd1740;
let maskCache: number[][] | null = null;

function gaussianKernel1D(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  return kernel.map((v) => v / sum);
}

function blurSeparable(src: number[][], sigma: number): number[][] {
  const h = src.length;
  const w = src[0].length;
  const k = gaussianKernel1D(sigma);
  const r = (k.length - 1) / 2;
  const tmp: number[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = 0; i < k.length; i++) {
        acc += src[y][(x + i - r + w) % w] * k[i];
      }
      tmp[y][x] = acc;
    }
  }
  const out: number[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = 0; i < k.length; i++) {
        acc += tmp[(y + i - r + h) % h][x] * k[i];
      }
      out[y][x] = acc;
    }
  }
  return out;
}

/**
 * Deterministic high-frequency threshold mask, tiled to h x w.
 * Built once from a seeded uniform field minus its low frequencies,
 * recentered on 128. Values stay in 0..255.
 */
export function blueNoiseMask(h: number, w: number): number[][] {
  if (!maskCache) {
    const rand = mulberry32(MASK_SEED);
    const base: number[][] = Array.from({ length: MASK_SIZE }, () =>
      Array.from({ length: MASK_SIZE }, () => Math.floor(rand() * 256)),
    );
    const low = blurSeparable(base, 4);
    maskCache = base.map((row, y) =>
      row.map((v, x) => Math.min(255, Math.max(0, v - low[y][x] + 128))),
    );
  }
  return tileMatrix(maskCache, h, w);
}
