// UI-side normalisation for the pure ops in ./ops: every operation set that
// leaves the store is sanitized here, so the worker never sees a value that
// would throw, and identity fields never reach the wire.

import type { CropRect, ImageOperations, QuarterTurn } from "./ops";

/** Identity operation set: no crop, no turns, no colour shift. */
export const IDENTITY_OPERATIONS: ImageOperations = Object.freeze({});

export type AdjustmentKey = "brightness" | "contrast" | "saturation" | "hue";

export interface AdjustmentDef {
  key: AdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Slider definitions for the colour adjustments, in panel order. */
export const ADJUSTMENTS: readonly AdjustmentDef[] = [
  { key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01 },
  { key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.01 },
  { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.01 },
  { key: "hue", label: "Hue", min: -180, max: 180, step: 1 },
];

const QUARTER_TURNS: readonly QuarterTurn[] = [0, 90, 180, 270];
const HUE_LIMIT = 180;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Clamp to the unit interval and drop float noise from slider steps. */
function unit(value: unknown): number | undefined {
  const n = finite(value);
  if (n === null) return undefined;
  return Math.round(clamp(n, -1, 1) * 100) / 100;
}

function hue(value: unknown): number | undefined {
  const n = finite(value);
  if (n === null) return undefined;
  return Math.round(clamp(n, -HUE_LIMIT, HUE_LIMIT) * 100) / 100;
}

function turn(value: unknown): QuarterTurn | undefined {
  return QUARTER_TURNS.includes(value as QuarterTurn) ? (value as QuarterTurn) : undefined;
}

function flag(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** Keep only whole-pixel crop rectangles that start at or after the origin. */
export function sanitizeCrop(value: unknown): CropRect | undefined {
  if (!isRecord(value)) return undefined;
  const x = integer(value.x);
  const y = integer(value.y);
  const width = integer(value.width);
  const height = integer(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/**
 * Coerce anything into a valid operation set: out-of-range numbers clamp,
 * wrong types and identity values drop out. Key order is fixed so serialised
 * payloads stay canonical.
 */
export function sanitizeOperations(value: unknown): ImageOperations {
  if (!isRecord(value)) return {};
  const out: ImageOperations = {};
  const crop = sanitizeCrop(value.crop);
  if (crop) out.crop = crop;
  const rotate = turn(value.rotate);
  if (rotate !== undefined && rotate !== 0) out.rotate = rotate;
  if (flag(value.flipHorizontal)) out.flipHorizontal = true;
  if (flag(value.flipVertical)) out.flipVertical = true;
  const brightness = unit(value.brightness);
  if (brightness) out.brightness = brightness;
  const contrast = unit(value.contrast);
  if (contrast) out.contrast = contrast;
  const saturation = unit(value.saturation);
  if (saturation) out.saturation = saturation;
  const hueShift = hue(value.hue);
  if (hueShift) out.hue = hueShift;
  if (flag(value.invert)) out.invert = true;
  return out;
}

/** Sanitize, then keep the crop inside the frame it will be applied to. */
export function fitOperations(operations: unknown, width: number, height: number): ImageOperations {
  const clean = sanitizeOperations(operations);
  if (!clean.crop) return clean;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    const { crop: _dropped, ...rest } = clean;
    return rest;
  }
  const x = Math.min(clean.crop.x, width - 1);
  const y = Math.min(clean.crop.y, height - 1);
  return {
    ...clean,
    crop: {
      x,
      y,
      width: Math.min(clean.crop.width, width - x),
      height: Math.min(clean.crop.height, height - y),
    },
  };
}

/**
 * Move a source-space crop onto a resized frame. Only crop carries
 * dimensions, so every other operation is scale invariant.
 */
export function scaleOperations(operations: unknown, factor: number): ImageOperations {
  const clean = sanitizeOperations(operations);
  if (!clean.crop) return clean;
  const scale = finite(factor);
  if (scale === null || scale <= 0) {
    const { crop: _dropped, ...rest } = clean;
    return rest;
  }
  const crop = clean.crop;
  return {
    ...clean,
    crop: {
      x: Math.round(crop.x * scale),
      y: Math.round(crop.y * scale),
      width: Math.max(1, Math.round(crop.width * scale)),
      height: Math.max(1, Math.round(crop.height * scale)),
    },
  };
}

/** True when nothing would change: the payload can be omitted entirely. */
export function isIdentity(operations: unknown): boolean {
  return Object.keys(sanitizeOperations(operations)).length === 0;
}

/**
 * Fit an operation set to the frame it will be applied to and drop it when it
 * is identity, so the worker skips a whole-frame copy per render.
 */
export function requestOperations(
  operations: unknown,
  width: number,
  height: number,
): ImageOperations | undefined {
  const fitted = fitOperations(operations, width, height);
  return isIdentity(fitted) ? undefined : fitted;
}

/** Stable key for change detection; identity for equivalent payloads. */
export function operationsKey(operations: unknown): string {
  const clean = sanitizeOperations(operations);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(clean).sort()) sorted[key] = clean[key as keyof ImageOperations];
  return JSON.stringify(sorted);
}

/** Read one adjustment with a numeric fallback, for slider values. */
export function adjustmentValue(operations: ImageOperations, key: AdjustmentKey): number {
  const value = finite(operations[key]);
  return value ?? 0;
}

/** Whole-frame rect for a source size, or a 1x1 stand-in when there is none. */
export function frameRect(width: number, height: number): CropRect {
  return sanitizeCrop({ x: 0, y: 0, width, height }) ?? { x: 0, y: 0, width: 1, height: 1 };
}

/** Rect a crop editor should show: the applied crop, else the whole frame. */
export function cropDraft(crop: CropRect | undefined, width: number, height: number): CropRect {
  return crop ?? frameRect(width, height);
}

/** Resync key for that draft: the frame size and the applied crop both matter. */
export function cropDraftKey(width: number, height: number, crop: CropRect | undefined): string {
  return `${width}x${height}:${operationsKey({ crop })}`;
}

/** Step the quarter turn clockwise: 0 → 90 → 180 → 270 → 0. */
export function nextQuarterTurn(current: unknown): QuarterTurn {
  const index = QUARTER_TURNS.indexOf(turn(current) ?? 0);
  return QUARTER_TURNS[(index + 1) % QUARTER_TURNS.length];
}
