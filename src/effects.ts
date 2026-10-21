// Stackable post-pipeline effects: pure RGBA buffer passes with a
// parameter schema per effect so UI can render controls generically.
// Every randomized effect is seeded: same inputs give same pixels.

import { mulberry32 } from "./prng.js";
import {
  assertRGBBuffer,
  nearestVisibleRGBA,
  premultiplyRGBA,
  unpremultiplyRGBA,
} from "./validation.js";
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

function effectDef(type: string): EffectDef {
  if (typeof type !== "string") throw new TypeError("effect type must be a string");
  const def = EFFECT_DEFS.find((candidate) => candidate.type === type);
  if (!def) throw new TypeError(`unknown effect type: ${type}`);
  return def;
}

function normalizeParams(type: string, params: EffectParams): EffectParams {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new TypeError("effect params must be an object");
  }
  const def = effectDef(type);
  const normalized: EffectParams = {};
  for (const param of def.params) {
    const value = params[param.key];
    if (value === undefined) {
      normalized[param.key] = param.def;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`effect parameter must be finite: ${param.key}`);
    }
    normalized[param.key] = Math.min(param.max, Math.max(param.min, value));
  }
  return normalized;
}

function copyOf(src: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(src);
}

function isIdentityEffect(type: string, params: EffectParams): boolean {
  if (type === "glow") return params.radius <= 0 || params.intensity <= 0;
  if (type === "chromatic-aberration") return Math.round(params.offset) === 0;
  if (type === "blur") return params.radius <= 0;
  if (type === "sharpen") return params.amount <= 0;
  if (type === "scanlines") return params.strength <= 0;
  if (type === "grain") return params.amount <= 0;
  return false;
}

/** Three horizontal and vertical sliding-window passes on RGB only. */
function blurRGBA(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  onRow?: RowProgress,
): Uint8ClampedArray {
  if (radius <= 0) return copyOf(src);
  const r = Math.max(1, Math.round(radius));
  const div = 2 * r + 1;
  let read = Float32Array.from(src);
  let write = new Float32Array(src.length);
  const clamp = (v: number, max: number): number => (v < 0 ? 0 : v >= max ? max - 1 : v);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += read[(row + clamp(i, w)) * 4 + c];
        for (let x = 0; x < w; x++) {
          write[(row + x) * 4 + c] = acc / div;
          acc += read[(row + clamp(x + r + 1, w)) * 4 + c] - read[(row + clamp(x - r, w)) * 4 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) acc += write[(clamp(i, h) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) {
          read[(y * w + x) * 4 + c] = acc / div;
          acc +=
            write[(clamp(y + r + 1, h) * w + x) * 4 + c] - write[(clamp(y - r, h) * w + x) * 4 + c];
        }
      }
    }
  }
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i++) out[i] = read[i];
  for (let i = 3; i < out.length; i += 4) out[i] = src[i];
  for (let y = 0; y < h; y++) onRow?.(y + 1, h, out, w, h);
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

function effectFunction(type: string): (typeof APPLY)[string] {
  if (typeof type !== "string" || !Object.hasOwn(APPLY, type)) {
    throw new TypeError(`unknown effect type: ${type}`);
  }
  return APPLY[type];
}

/** Default params for an effect type. */
export function defaultEffectParams(type: string): EffectParams {
  const def = effectDef(type);
  const params: EffectParams = {};
  for (const p of def.params) params[p.key] = p.def;
  return params;
}

/** Apply one effect. */
export function applyEffect(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  type: string,
  params: EffectParams,
  onRow?: RowProgress,
): Uint8ClampedArray {
  assertRGBBuffer(src, w, h, 4);
  const normalized = normalizeParams(type, params);
  const fn = effectFunction(type);
  if (isIdentityEffect(type, normalized)) return copyOf(src);
  // Premultiply first: nearestVisibleRGBA then fills the transparent blocks
  // with visible *premultiplied* colour. Filling before premultiplying would
  // be undone for every fully transparent pixel, and blur/glow would spread
  // black into the visible edge.
  const working = nearestVisibleRGBA(premultiplyRGBA(src), w, h);
  const progress = onRow
    ? (
        done: number,
        total: number,
        out: Uint8Array | Uint8ClampedArray,
        width: number,
        height: number,
      ) => {
        onRow(done, total, unpremultiplyRGBA(out as Uint8ClampedArray, src), width, height);
      }
    : undefined;
  const result = fn(working, w, h, normalized, progress);
  return unpremultiplyRGBA(result, src);
}

/** Run the enabled chain in order. */
export function applyEffects(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  effects: EffectInstance[],
  onRow?: RowProgress,
): Uint8ClampedArray {
  assertRGBBuffer(src, w, h, 4);
  if (!Array.isArray(effects)) throw new TypeError("effects must be an array");
  let buf = copyOf(src);
  for (const effect of effects) {
    if (typeof effect !== "object" || effect === null) {
      throw new TypeError("effect entries must be objects");
    }
    if (typeof effect.enabled !== "boolean")
      throw new TypeError("effect.enabled must be a boolean");
    if (!effect.enabled) continue;
    const params = normalizeParams(effect.type, effect.params);
    buf = applyEffect(buf, w, h, effect.type, params, onRow);
  }
  return buf;
}
