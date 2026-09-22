// Stackable post-pipeline effects: pure RGBA buffer passes with a
// parameter schema per effect so UI can render controls generically.
// Every randomized effect is seeded: same inputs give same pixels.

import { mulberry32 } from "./prng.js";
import type { RowProgress } from "./types.js";

export interface EffectParams {
  [key: string]: number;
}

export interface EffectInstance {
  type: string;
  params: EffectParams;
  enabled: boolean;
}

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

export interface EffectDef {
  type: string;
  label: string;
  params: EffectParamDef[];
}

function num(params: EffectParams, key: string, def: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

function copyOf(src: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(src);
}

function gaussianKernel(sigma: number): number[] {
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

/** Separable gaussian blur of the RGB channels; alpha untouched. */
function blurRGBA(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  onRow?: RowProgress,
): Uint8ClampedArray {
  if (radius <= 0) return copyOf(src);
  const k = gaussianKernel(radius);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = 0; i < k.length; i++) {
          const sx = Math.min(w - 1, Math.max(0, x + i - r));
          acc += src[(y * w + sx) * 4 + c] * k[i];
        }
        tmp[(y * w + x) * 4 + c] = acc;
      }
      tmp[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
    }
  }
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let i = 0; i < k.length; i++) {
          const sy = Math.min(h - 1, Math.max(0, y + i - r));
          acc += (c === 3 ? src[(sy * w + x) * 4 + c] : tmp[(sy * w + x) * 4 + c]) * k[i];
        }
        out[(y * w + x) * 4 + c] = acc;
      }
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

function glowEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const radius = num(params, "radius", 4);
  const k = num(params, "intensity", 30) / 100;
  if (radius <= 0 || k <= 0) return copyOf(src);
  const blurred = blurRGBA(src, w, h, radius);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = src[i + c];
        const glow = Math.min(255, blurred[i + c] * k);
        out[i + c] = base + glow - (base * glow) / 255;
      }
      out[i + 3] = src[i + 3];
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

function aberrationEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const ox = Math.round(num(params, "offset", 2));
  if (ox === 0) return copyOf(src);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      const rl = (y * w + Math.min(w - 1, Math.max(0, x - ox))) * 4;
      const rr = (y * w + Math.min(w - 1, Math.max(0, x + ox))) * 4;
      out[d] = src[rl];
      out[d + 1] = src[d + 1];
      out[d + 2] = src[rr + 2];
      out[d + 3] = src[d + 3];
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

function blurEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  return blurRGBA(src, w, h, num(params, "radius", 2), onRow);
}

function sharpenEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const amount = num(params, "amount", 1);
  if (amount <= 0) return copyOf(src);
  const blurred = blurRGBA(src, w, h, 1);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = src[i + c] + (src[i + c] - blurred[i + c]) * amount;
      out[i + 3] = src[i + 3];
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

function jpegEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const quality = Math.min(100, Math.max(1, num(params, "quality", 50)));
  const rand = mulberry32(Math.floor(num(params, "seed", 1)));
  const levels = 2 + Math.round((quality / 100) * 6);
  const step = 256 / levels;
  const displace = Math.round((1 - quality / 100) * 8);
  const out = copyOf(src);
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      const shift = displace === 0 ? 0 : Math.floor((rand() * 2 - 1) * displace);
      for (let y = 0; y < 8 && by + y < h; y++) {
        for (let x = 0; x < 8 && bx + x < w; x++) {
          const sx = Math.min(w - 1, Math.max(0, bx + x + shift));
          const s = ((by + y) * w + sx) * 4;
          const d = ((by + y) * w + bx + x) * 4;
          for (let c = 0; c < 3; c++) out[d + c] = Math.floor(src[s + c] / step) * step;
          out[d + 3] = src[d + 3];
        }
      }
    }
    onRow?.(Math.min(h, by + 8), h, out, w, h);
  }
  return out;
}

function scanlinesEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const pitch = Math.max(1, Math.round(num(params, "pitch", 3)));
  const s = Math.min(1, Math.max(0, num(params, "strength", 30) / 100));
  if (s <= 0) return copyOf(src);
  const out = copyOf(src);
  for (let y = 0; y < h; y++) {
    if (y % pitch !== pitch - 1) {
      onRow?.(y + 1, h, out, w, h);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[d + c] = src[d + c] * (1 - s);
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

function grainEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const amount = Math.max(0, num(params, "amount", 10));
  if (amount <= 0) return copyOf(src);
  const rand = mulberry32(Math.floor(num(params, "seed", 1)));
  const out = copyOf(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = src[i + c] + (rand() * 2 - 1) * amount;
    }
    onRow?.(y + 1, h, out, w, h);
  }
  return out;
}

const APPLY: Record<
  string,
  (
    src: Uint8ClampedArray,
    w: number,
    h: number,
    params: EffectParams,
    onRow?: RowProgress,
  ) => Uint8ClampedArray
> = {
  glow: glowEffect,
  "chromatic-aberration": aberrationEffect,
  blur: blurEffect,
  sharpen: sharpenEffect,
  "jpeg-glitch": jpegEffect,
  scanlines: scanlinesEffect,
  grain: grainEffect,
};

export const EFFECT_DEFS: EffectDef[] = [
  {
    type: "glow",
    label: "Glow",
    params: [
      { key: "radius", label: "Radius", min: 0, max: 20, step: 0.5, def: 4 },
      { key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, def: 30 },
    ],
  },
  {
    type: "chromatic-aberration",
    label: "Chromatic aberration",
    params: [{ key: "offset", label: "Offset", min: 0, max: 12, step: 1, def: 2 }],
  },
  {
    type: "blur",
    label: "Blur",
    params: [{ key: "radius", label: "Radius", min: 0, max: 10, step: 0.5, def: 2 }],
  },
  {
    type: "sharpen",
    label: "Sharpen",
    params: [{ key: "amount", label: "Amount", min: 0, max: 5, step: 0.1, def: 1 }],
  },
  {
    type: "jpeg-glitch",
    label: "JPEG glitch",
    params: [
      { key: "quality", label: "Quality", min: 1, max: 100, step: 1, def: 50 },
      { key: "seed", label: "Seed", min: 1, max: 9999, step: 1, def: 1 },
    ],
  },
  {
    type: "scanlines",
    label: "Scanlines",
    params: [
      { key: "pitch", label: "Pitch", min: 1, max: 8, step: 1, def: 3 },
      { key: "strength", label: "Strength", min: 0, max: 100, step: 1, def: 30 },
    ],
  },
  {
    type: "grain",
    label: "Grain",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 64, step: 1, def: 10 },
      { key: "seed", label: "Seed", min: 1, max: 9999, step: 1, def: 1 },
    ],
  },
];

/** Default params for an effect type (empty record for unknown types). */
export function defaultEffectParams(type: string): EffectParams {
  const def = EFFECT_DEFS.find((d) => d.type === type);
  if (!def) return {};
  const params: EffectParams = {};
  for (const p of def.params) params[p.key] = p.def;
  return params;
}

/** Apply one effect; unknown types pass through untouched. */
export function applyEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  type: string,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  const fn = APPLY[type];
  return fn ? fn(src, w, h, params, onRow) : copyOf(src);
}

/** Run the enabled chain in order; disabled and unknown entries are no-ops. */
export function applyEffects(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  effects: EffectInstance[],
  onRow?: RowProgress,
): Uint8ClampedArray {
  let buf = copyOf(src);
  for (const e of effects) {
    if (e.enabled) buf = applyEffect(buf, w, h, e.type, e.params, onRow);
  }
  return buf;
}
