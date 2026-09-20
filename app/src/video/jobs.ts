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

export const MAX_DIFFUSION_DIM = 720;
export const MAX_ORDERED_DIM = 1080;

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

/** Fit w*h inside maxDim on the long edge, preserving aspect. */
export function fitSize(w: number, h: number, maxDim: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxDim) return { width: w, height: h };
  const k = maxDim / long;
  return {
    width: Math.max(2, Math.round((w * k) / 2) * 2),
    height: Math.max(2, Math.round((h * k) / 2) * 2),
  };
}

/**
 * Plan frame extraction. Range is clamped to the clip; fps is clamped
 * to 1..30; timestamps exclude the exact end to avoid a duplicate seek.
 */
export function planFrames(
  clip: ClipInfo,
  range: { start: number; end: number },
  fps: number,
  method: string,
): FramePlan {
  const safeFps = Math.min(30, Math.max(1, Math.round(fps)));
  const start = Math.min(Math.max(0, range.start), clip.duration);
  const end = Math.min(Math.max(start, range.end), clip.duration);
  const span = end - start;
  const count = Math.max(1, Math.floor(span * safeFps));
  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(start + (i * span) / count);
  const size = fitSize(
    clip.width,
    clip.height,
    isOrderedMethod(method) ? MAX_ORDERED_DIM : MAX_DIFFUSION_DIM,
  );
  return { times, width: size.width, height: size.height, fps: safeFps };
}
