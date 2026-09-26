// Frame job planner: pure math over clip metadata. Which timestamps to
// sample, at what working size, in what order. No DOM here so it stays
// unit-testable.

export interface ClipInfo {
  duration: number; // seconds
  width: number;
  height: number;
}

export interface FramePlan {
  /** Sample timestamps in seconds, ascending. */
  times: number[];
  /** Working size (capped, aspect-preserved). */
  width: number;
  height: number;
  fps: number;
}

export interface PlanFramesOptions {
  /** Long-edge cap overriding the method default. */
  maxDim?: number;
}

export const MAX_DIFFUSION_DIM = 720;
export const MAX_ORDERED_DIM = 1080;
export const MAX_VIDEO_FRAMES = 3600;
/** Hard ceiling for the explicit full-resolution export, whatever the method. */
export const MAX_FULL_RES_DIM = 3840;
/** Still-preview cap for heavy diffusion scans. */
export const MAX_HEAVY_PREVIEW_DIM = 720;

/** Wide-spread or stateful scans too slow for full-res still previews. */
export const HEAVY_METHODS: readonly string[] = [
  "Stevenson-Arce",
  "Jarvis-Judice-Ninke",
  "Stucki",
  "Ostromoukhov",
  "Variable-Error",
  "Dot-Diffusion",
  "Riemersma",
];

/** True for methods needing the preview cap above their native size. */
export function isHeavyMethod(method: string): boolean {
  return HEAVY_METHODS.includes(method);
}

/** True for methods fast enough to run at full HD. */
export function isOrderedMethod(method: string): boolean {
  return (
    method.startsWith("Bayer") ||
    method === "Clustered-Dot" ||
    method === "Halftone" ||
    method === "Blue-Noise" ||
    method === "Void-and-Cluster" ||
    method === "Pattern" ||
    method === "Crosshatch" ||
    method === "Blue-Noise Mask" ||
    method === "None"
  );
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
}

/** Fit w*h inside maxDim on the long edge, preserving aspect. */
export function fitSize(w: number, h: number, maxDim: number): { width: number; height: number } {
  assertFinitePositive(w, "width");
  assertFinitePositive(h, "height");
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new RangeError("width and height must be finite integer dimensions");
  }
  assertFinitePositive(maxDim, "maxDim");
  const long = Math.max(w, h);
  if (long <= maxDim) return { width: w, height: h };
  const k = maxDim / long;
  return {
    width: Math.max(2, Math.round((w * k) / 2) * 2),
    height: Math.max(2, Math.round((h * k) / 2) * 2),
  };
}

/**
 * Clamp an in/out pair into the clip: finite, ordered, inside the duration.
 * An In past the Out point pushes Out along, since In is what was just typed.
 */
export function clampRange(
  range: { start: number; end: number },
  duration: number,
): { start: number; end: number } {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const bound = (value: number, fallback: number): number =>
    Math.min(limit, Math.max(0, Number.isFinite(value) ? value : fallback));
  const start = bound(range.start, 0);
  const end = Math.max(start, bound(range.end, limit));
  return { start, end };
}

/** Method cap unless the caller asked for a specific long edge. */
export function planMaxDim(method: string, maxDim?: number): number {
  if (maxDim !== undefined) {
    if (!Number.isInteger(maxDim) || maxDim <= 0) {
      throw new RangeError("maxDim must be a finite positive integer");
    }
    return maxDim;
  }
  return isOrderedMethod(method) ? MAX_ORDERED_DIM : MAX_DIFFUSION_DIM;
}

/**
 * Working size for a single preview frame. Deliberately not planFrames: that
 * also budgets the export range, so a long clip would throw on the frame
 * ceiling and take scrubbing and playback down with it.
 */
export function previewSize(clip: ClipInfo, method: string): { width: number; height: number } {
  return fitSize(clip.width, clip.height, planMaxDim(method));
}

export function planFrames(
  clip: ClipInfo,
  range: { start: number; end: number },
  fps: number,
  method: string,
  options: PlanFramesOptions = {},
): FramePlan {
  assertFinitePositive(clip.duration, "clip duration");
  if (!Number.isInteger(clip.width) || !Number.isInteger(clip.height)) {
    throw new RangeError("clip width and height must be finite integer dimensions");
  }
  assertFinitePositive(clip.width, "clip width");
  assertFinitePositive(clip.height, "clip height");
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new RangeError("range start and end must be finite numbers");
  }
  if (range.start < 0 || range.end > clip.duration || range.start > range.end) {
    throw new RangeError(
      `invalid frame range: start must be within 0..duration and end must be at least start`,
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("fps must be a finite positive number");
  }
  const safeFps = Math.min(30, Math.max(1, Math.round(fps)));
  const start = range.start;
  const end = range.end;
  const span = end - start;
  const count = Math.max(1, Math.ceil(span * safeFps));
  if (count > MAX_VIDEO_FRAMES) {
    throw new RangeError(
      `frame range produces ${count} frames; maximum is ${MAX_VIDEO_FRAMES} frames`,
    );
  }
  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(start + (i * span) / count);
  const size = fitSize(clip.width, clip.height, planMaxDim(method, options.maxDim));
  return { times, width: size.width, height: size.height, fps: safeFps };
}
