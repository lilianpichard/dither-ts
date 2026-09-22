import { applyEffects, ditherColor, ditherGray, grayscaleFromRGB } from "../../../src/index.js";
import type { EffectInstance, RGB } from "../../../src/index.js";

export interface RenderRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred to the worker. */
  pixels: ArrayBuffer;
  color: boolean;
  method: string;
  threshold: number;
  palette: string | RGB[];
  pixelSize: number;
  effects: EffectInstance[];
  /** Threshold-field shift for animated ordered variation (0 = still). */
  seed: number;
  /** Post a progress frame every N completed rows (0 = final only). */
  progressEvery?: number;
}

export interface RenderProgress {
  kind: "progress";
  id: number;
  width: number;
  height: number;
  rowsDone: number;
  totalRows: number;
  /** Full-size RGBA with rows below rowsDone final. */
  pixels: ArrayBuffer;
}

export interface RenderResponse {
  kind: "result";
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred back. */
  pixels: ArrayBuffer;
  ms: number;
}

export type RenderMessage = RenderProgress | RenderResponse;

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const t0 = performance.now();
  const {
    id,
    width,
    height,
    pixels,
    color,
    method,
    threshold,
    palette,
    pixelSize,
    effects,
    seed,
    progressEvery,
  } = e.data;
  const rgba = new Uint8ClampedArray(pixels);
  const count = width * height;
  const rgb = new Uint8ClampedArray(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const every = progressEvery && progressEvery > 0 ? Math.floor(progressEvery) : 0;
  const postPartial = (
    rowsDone: number,
    totalRows: number,
    out: Uint8Array | Uint8ClampedArray,
    w: number,
    h: number,
  ): void => {
    if (rowsDone % every !== 0 && rowsDone !== totalRows) return;
    const frame = color
      ? packColor(out as Uint8ClampedArray, w, h)
      : packGray(out as Uint8Array, w, h);
    const msg: RenderProgress = {
      kind: "progress",
      id,
      width: w,
      height: h,
      rowsDone,
      totalRows,
      pixels: frame.buffer as ArrayBuffer,
    };
    self.postMessage(msg, { transfer: [frame.buffer as ArrayBuffer] });
  };
  const onRow = every > 0 ? postPartial : undefined;

  if (color) {
    const run = ditherColor(rgb, width, height, {
      method,
      palette,
      pixelSize,
      seed,
      onProgress: onRow,
    });
    finish(id, width, height, t0, packColor(run, width, height), effects, every);
  } else {
    const g = grayscaleFromRGB(rgb, width, height);
    const run = ditherGray(g, { method, threshold, pixelSize, seed, onProgress: onRow });
    finish(id, width, height, t0, packGray(run, width, height), effects, every);
  }
};

function packGray(o: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < o.length; i++) {
    out[i * 4] = o[i];
    out[i * 4 + 1] = o[i];
    out[i * 4 + 2] = o[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function packColor(o: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = o[i * 3];
    out[i * 4 + 1] = o[i * 3 + 1];
    out[i * 4 + 2] = o[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function finish(
  id: number,
  width: number,
  height: number,
  t0: number,
  rgba: Uint8ClampedArray,
  effects: EffectInstance[],
  every: number,
): void {
  const onRow =
    every > 0
      ? (
          rowsDone: number,
          totalRows: number,
          out: Uint8Array | Uint8ClampedArray,
          w: number,
          h: number,
        ): void => {
          if (rowsDone % every !== 0 && rowsDone !== totalRows) return;
          const frame = new Uint8ClampedArray(out);
          const msg: RenderProgress = {
            kind: "progress",
            id,
            width: w,
            height: h,
            rowsDone,
            totalRows,
            pixels: frame.buffer as ArrayBuffer,
          };
          self.postMessage(msg, { transfer: [frame.buffer as ArrayBuffer] });
        }
      : undefined;
  const final = applyEffects(rgba, width, height, effects, onRow);
  const response: RenderResponse = {
    kind: "result",
    id,
    width,
    height,
    pixels: final.buffer as ArrayBuffer,
    ms: performance.now() - t0,
  };
  self.postMessage(response, { transfer: [final.buffer as ArrayBuffer] });
}
