// Operations travel to video frames from the image editor, where a crop is
// authored in source pixels. Video frames are decoded at the planned working
// size, so the crop has to be scaled before the worker sees it.

import { requestOperations, scaleOperations } from "../image/settings";
import type { ImageOperations } from "../image/ops";

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Fit an operation set to one video frame: source-space crop scaled to the
 * working frame, then clamped to it. Identity sets are dropped so the worker
 * skips its per-frame copy.
 */
export function frameOperations(
  operations: ImageOperations,
  source: FrameSize,
  frame: FrameSize,
): ImageOperations | undefined {
  const scale = source.width > 0 && source.height > 0 ? frame.width / source.width : 1;
  return requestOperations(scaleOperations(operations, scale), frame.width, frame.height);
}
