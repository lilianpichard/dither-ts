// Ordered dither matrices (0..255).

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
  Array.from({ length: 8 }, (__, j) => ((i + j) % 8) * 32.0)
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

/** Tile a small matrix to h x w (mirrors numpy tile in matrices.py). */
export function tileMatrix(matrix: number[][], h: number, w: number): number[][] {
  const mh = matrix.length;
  const mw = matrix[0].length;
  const out: number[][] = new Array(h);
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    const src = matrix[y % mh];
    for (let x = 0; x < w; x++) row[x] = src[x % mw];
    out[y] = row;
  }
  return out;
}
