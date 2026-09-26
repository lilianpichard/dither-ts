import { GIFEncoder } from "gifenc";
import { nearestRGBIndex, PALETTES, type RGB } from "../../../src/index.js";
import {
  asyncFrameIterator,
  closeExportIterator,
  exportByteCapError,
  nextExportFrame,
  validateExportByteCap,
  validateExportFrame,
  type ExportFrameSource,
  type ExportOptions,
} from "./exportMp4";

export interface GifExportOptions extends ExportOptions {
  monochrome?: boolean;
  color?: boolean;
}

function hasPalette(name: string): boolean {
  return Object.hasOwn(PALETTES, name);
}

export function resolveExportPalette(ref: string | RGB[], monochrome = false): RGB[] {
  const fallback = PALETTES["B&W"];
  if (monochrome) return fallback;
  // A preset can name any string, so the lookup has to be own-property: an
  // inherited `constructor` is not a colour list and must not pass through.
  if (typeof ref === "string") return hasPalette(ref) ? PALETTES[ref] : fallback;
  if (!Array.isArray(ref) || ref.length < 2 || ref.length > 256) return fallback;
  return ref;
}

function abortError(): Error {
  const error = new Error("GIF export cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function totalFrames(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("frame total must be a finite non-negative number");
  }
  return Math.floor(value);
}

function gifByteLength(gif: ReturnType<typeof GIFEncoder>): number {
  const withView = gif as ReturnType<typeof GIFEncoder> & {
    bytesView?: () => ArrayBufferView;
  };
  if (typeof withView.bytesView === "function") return withView.bytesView().byteLength;
  return gif.bytes().byteLength;
}

export async function exportGif(
  frames: ExportFrameSource,
  fps: number,
  paletteRef: string | RGB[],
  onProgress?: (done: number, total: number) => void,
  options: GifExportOptions = {},
): Promise<Blob> {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("fps must be finite and positive");
  const signal = options.signal ?? options.controller?.signal;
  throwIfAborted(signal);
  const monochrome = options.monochrome ?? options.color === false;
  const palette = resolveExportPalette(paletteRef, monochrome);
  const gifPalette: Array<[number, number, number]> = palette.map((color) => [
    color[0],
    color[1],
    color[2],
  ]);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / Math.min(30, Math.max(1, Math.round(fps))));
  const total = totalFrames(options.total ?? (Array.isArray(frames) ? frames.length : undefined));
  const maxBytes = validateExportByteCap(options.maxBytes);
  let count = 0;
  let width: number | undefined;
  let height: number | undefined;
  let finished = false;

  const iterator = asyncFrameIterator(frames);
  let sourceDone = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await nextExportFrame(iterator, signal);
      if (result.done) {
        sourceDone = true;
        break;
      }
      const frame = result.value;
      validateExportFrame(frame);
      if (width === undefined) {
        width = frame.width;
        height = frame.height;
      } else if (frame.width !== width || frame.height !== height) {
        throw new Error("all export frames must have the same dimensions");
      }
      const indexStream = new Uint8Array(frame.width * frame.height);
      for (let i = 0; i < indexStream.length; i++) {
        indexStream[i] = nearestRGBIndex(
          frame.data[i * 4],
          frame.data[i * 4 + 1],
          frame.data[i * 4 + 2],
          palette,
        );
      }
      gif.writeFrame(indexStream, frame.width, frame.height, { palette: gifPalette, delay });
      if (gifByteLength(gif) > maxBytes) throw exportByteCapError(maxBytes);
      count++;
      onProgress?.(count, total);
      throwIfAborted(signal);
    }
    throwIfAborted(signal);
    if (count === 0) throw new Error("no frames to export");
    if (gifByteLength(gif) > maxBytes) throw exportByteCapError(maxBytes);
    gif.finish();
    if (gifByteLength(gif) > maxBytes) throw exportByteCapError(maxBytes);
    const raw = gif.bytes();
    const bytes = new Uint8Array(raw.length);
    bytes.set(raw);
    const blob = new Blob([bytes.buffer], { type: "image/gif" });
    finished = true;
    return blob;
  } finally {
    if (!finished) {
      try {
        options.controller?.abort();
        options.abort?.();
      } catch {}
    }
    try {
      await closeExportIterator(iterator, signal, sourceDone, !finished);
    } catch {}
    if (!finished) {
      try {
        gif.reset();
      } catch {}
    }
  }
}
