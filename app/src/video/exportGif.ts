// GIF export: frames mapped to the active palette (all built-in and
// custom palettes fit in 256 colors), encoded with gifenc.

import { GIFEncoder } from "gifenc";
import { nearestRGBIndex, PALETTES, type RGB } from "../../../src/index.js";
import type { ExportFrame } from "./exportMp4";

export function resolveExportPalette(ref: string | RGB[]): RGB[] {
  if (typeof ref === "string") return PALETTES[ref] ?? PALETTES["B&W"];
  return ref.length >= 2 ? ref : PALETTES["B&W"];
}

export function exportGif(
  frames: ExportFrame[],
  fps: number,
  paletteRef: string | RGB[],
  onProgress?: (done: number, total: number) => void,
): Blob {
  if (frames.length === 0) throw new Error("no frames to export");
  const palette = resolveExportPalette(paletteRef);
  const gifPalette: Array<[number, number, number]> = palette.map((c) => [c[0], c[1], c[2]]);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / Math.min(30, Math.max(1, fps)));
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k];
    const indexStream = new Uint8Array(f.width * f.height);
    for (let i = 0; i < f.width * f.height; i++) {
      indexStream[i] = nearestRGBIndex(
        f.data[i * 4],
        f.data[i * 4 + 1],
        f.data[i * 4 + 2],
        palette,
      );
    }
    gif.writeFrame(indexStream, f.width, f.height, { palette: gifPalette, delay });
    onProgress?.(k + 1, frames.length);
  }
  gif.finish();
  const raw = gif.bytes();
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "image/gif" });
}
