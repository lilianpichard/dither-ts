import type { RenderRequest } from "../worker/render";
import type { DitherParams, ImageSource, RenderResult, StackedEffect } from "../store";
import { requestOperations } from "../image/settings";
import type { ImageOperations } from "../image/ops";

export async function runExportAction<T>(
  value: T,
  signal: AbortSignal,
  action: (value: T, signal: AbortSignal) => void | Promise<void>,
): Promise<boolean> {
  await action(value, signal);
  return !signal.aborted;
}

export function nextExportProgress(rowsDone: number, totalRows: number, previous = 0): number {
  const previousValue = Number.isFinite(previous) ? Math.min(100, Math.max(0, previous)) : 0;
  const current =
    Number.isFinite(rowsDone) && Number.isFinite(totalRows) && totalRows > 0
      ? Math.min(100, Math.max(0, (rowsDone / totalRows) * 100))
      : 100;
  return Math.max(previousValue, current);
}

export function buildExportRenderRequest(
  source: ImageSource,
  params: DitherParams,
  effects: StackedEffect[],
  operations: ImageOperations = {},
): Omit<RenderRequest, "id"> {
  return {
    width: source.width,
    height: source.height,
    pixels: source.pixels.slice(0),
    color: params.color,
    method: params.method,
    threshold: params.threshold,
    palette: params.palette,
    pixelSize: params.pixelSize,
    effects: effects.map((effect) => ({
      type: effect.type,
      params: { ...effect.params },
      enabled: effect.enabled,
    })),
    // Source-space crop, clamped to the full-resolution frame being written.
    operations: requestOperations(operations, source.width, source.height),
    seed: 0,
    progressEvery: source.height > 400 ? Math.max(1, Math.floor(source.height / 16)) : 0,
  };
}

export function canExport(
  result: RenderResult | null,
  rendering: boolean,
  exporting: boolean,
): boolean {
  return result !== null && result.partial !== true && !rendering && !exporting;
}
