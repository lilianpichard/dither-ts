import { GIFEncoder, quantize } from "gifenc";
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

/**
 * The distinct RGB values a frame actually contains, or `null` if there are more
 * than a GIF can hold.
 *
 * Original colour mode posterises to a handful of levels per channel, so a frame
 * has far fewer than 256 colours and the GIF can be exact. Forcing the chosen
 * palette on it instead was what made those exports look like a blurry mess.
 */
export function exactFramePalette(
  data: Uint8ClampedArray,
  limit = 256,
): Array<[number, number, number]> | null {
  const seen = new Set<number>();
  for (let i = 0; i + 2 < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    // Pack to one integer: three bytes cannot collide in a 32-bit int.
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    if (seen.size > limit) return null;
  }
  return [...seen].map((packed) => [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]);
}

/** A gif colour table is at most this wide. */
const GIF_PALETTE_LIMIT = 256;

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
  const fallback = resolveExportPalette(paletteRef, monochrome);
  // The palette is fixed for the whole file, so it is settled from the first
  // frame: either that frame's own colours, or the configured palette.
  let palette = fallback;
  let gifPalette: Array<[number, number, number]> = fallback.map((color) => [
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
        if (!monochrome) {
          // Exact first: a posterised or palette-locked frame already fits. A
          // table of one colour is refused by the encoder, so a single-colour
          // frame falls through rather than producing a broken gif.
          const exact = exactFramePalette(frame.data);
          if (exact !== null && exact.length > 1) {
            palette = exact.map(([r, g, b]) => [r, g, b]);
            gifPalette = exact;
          } else {
            // Too many colours for a table, so build one from the frame. The
            // old fallback was the configured palette, which is two colours
            // wide when a preset names one the kernel does not have, and that
            // is what turned a colour preview into a black and white gif.
            const fitted = quantize(frame.data, GIF_PALETTE_LIMIT);
            if (fitted.length > 1) {
              palette = fitted.map(([r, g, b]) => [r, g, b]);
              gifPalette = fitted;
            }
          }
        }
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
