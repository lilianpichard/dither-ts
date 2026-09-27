import { applyEffects, ditherRGBA } from "../../../src/index.js";
import type {
  ColorMode,
  DitherMethod,
  EffectInstance,
  RGB,
  RGBAImage,
} from "../../../src/index.js";
import { applyOperations, type ImageOperations } from "../image/ops";

export interface RenderRequest {
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; transferred to the worker. */
  pixels: ArrayBuffer;
  color: boolean;
  /**
   * Required on purpose. Unlike the preset format, nothing is ever read back
   * into this type, so there is no legacy caller to accommodate — and making it
   * optional is exactly how the export, batch and video paths each forgot to
   * pass it and silently fell back to the palette.
   */
  colorMode: ColorMode;
  method: DitherMethod;
  threshold: number;
  palette: string | RGB[];
  pixelSize: number;
  effects: EffectInstance[];
  /** Transform and colour adjustments applied before dithering (default identity). */
  operations?: ImageOperations;
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

/** Sink for worker output; the buffer in `message.pixels` is transferred. */
export type PostMessage = (message: RenderMessage, transfer: Transferable[]) => void;

/**
 * Run one render request: operations, then dither, then effects. Output
 * carries the post-operation dimensions, so a crop or turn changes the frame
 * size the client receives.
 */
export function runRender(request: RenderRequest, post: PostMessage): void {
  const t0 = performance.now();
  const {
    id,
    width,
    height,
    pixels,
    color,
    colorMode,
    method,
    palette,
    threshold,
    pixelSize,
    effects,
    operations,
    seed,
    progressEvery,
  } = request;
  const source: RGBAImage = { width, height, data: new Uint8ClampedArray(pixels) };
  const prepared = operations ? applyOperations(source, operations) : source;
  const every = progressEvery && progressEvery > 0 ? Math.floor(progressEvery) : 0;
  const postPartial = (
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
    post(msg, [frame.buffer as ArrayBuffer]);
  };
  const run = ditherRGBA(prepared, {
    color,
    colorMode,
    method,
    palette,
    threshold,
    pixelSize,
    seed,
    onProgress: every > 0 ? postPartial : undefined,
  });
  const final = applyEffects(run, prepared.width, prepared.height, effects);
  const response: RenderResponse = {
    kind: "result",
    id,
    width: prepared.width,
    height: prepared.height,
    pixels: final.buffer as ArrayBuffer,
    ms: performance.now() - t0,
  };
  post(response, [final.buffer as ArrayBuffer]);
}

if (typeof self !== "undefined") {
  self.onmessage = (event: MessageEvent<RenderRequest>) => {
    runRender(event.data, (message, transfer) => self.postMessage(message, { transfer }));
  };
}
