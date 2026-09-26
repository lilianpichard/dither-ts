import { assertByteBuffer, assertDimensions } from "./validation.js";

/** Classic density ramp, dark to bright. */
export const DEFAULT_CHARSET = "@%#*+=-:. ";

export interface TxtOptions {
  /** Cell edge in pixels. */
  cell?: number;
  /** Glyphs ordered dark to bright. */
  charset?: string;
  /** Flip the ramp. */
  invert?: boolean;
}

/**
 * Render a grayscale buffer as text rows. Output dimensions are
 * ceil(w/cell) by ceil(h/cell), rows joined with "\n".
 */
export function exportTXT(bw: Uint8Array, w: number, h: number, opts: TxtOptions = {}): string {
  assertDimensions(w, h);
  assertByteBuffer(bw, w * h, "grayscale buffer");
  if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
    throw new TypeError("TXT options must be an object");
  }
  const cell = opts.cell ?? 8;
  if (!Number.isSafeInteger(cell) || cell <= 0) {
    throw new TypeError("cell must be a positive safe integer");
  }
  const charset = opts.charset ?? DEFAULT_CHARSET;
  if (typeof charset !== "string" || charset.length === 0) {
    throw new TypeError("charset must be a non-empty string");
  }
  if (opts.invert !== undefined && typeof opts.invert !== "boolean") {
    throw new TypeError("invert must be a boolean");
  }
  const codePoints = [...charset];
  const ramp = opts.invert ? codePoints.reverse() : codePoints;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0;
      let n = 0;
      for (let y = cy * cell; y < Math.min(h, cy * cell + cell); y++) {
        for (let x = cx * cell; x < Math.min(w, cx * cell + cell); x++) {
          sum += bw[y * w + x];
          n++;
        }
      }
      const idx = Math.min(ramp.length - 1, Math.floor((sum / n / 255) * ramp.length));
      line += ramp[idx];
    }
    lines.push(line);
  }
  return lines.join("\n");
}
