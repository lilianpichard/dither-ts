// The pixel size a frame is rendered at, and what it has to become on the way
// to a frame of a different size.

import { proportionalPixelSize } from "../../../src/index.js";

export interface Sized {
  width: number;
  height: number;
}

/**
 * Pixel size for the video preview, which is capped below the clip's own size
 * for the heavy scans. Scaling keeps the block's share of the frame the same as
 * the export the settings will produce.
 */
export function previewPixelSize(params: { pixelSize: number }, clip: Sized, frame: Sized): number {
  return proportionalPixelSize(
    params.pixelSize,
    Math.max(frame.width, frame.height),
    Math.max(clip.width, clip.height),
  );
}

/**
 * Pixel size for the video export. The frame may be larger than the clip when
 * full resolution is asked for, so the block grows to keep its share.
 */
export function exportPixelSize(params: { pixelSize: number }, clip: Sized, frame: Sized): number {
  return proportionalPixelSize(
    params.pixelSize,
    Math.max(frame.width, frame.height),
    Math.max(clip.width, clip.height),
  );
}

/**
 * Pixel size for a still preview that was capped for a heavy scan. Identical to
 * the video case, kept separate because the two take different inputs and read
 * differently at the call site.
 */
export function cappedPixelSize(
  params: { pixelSize: number },
  frame: Sized,
  source: Sized,
): number {
  return proportionalPixelSize(
    params.pixelSize,
    Math.max(frame.width, frame.height),
    Math.max(source.width, source.height),
  );
}
