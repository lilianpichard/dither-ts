// TXT export: map each cell of a grayscale buffer to a glyph from a
// density-ordered charset (dark to bright). Charsets are plain strings
// so users can supply their own sets.

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
  const cell = Math.max(1, Math.floor(opts.cell ?? 8));
  const ramp = opts.invert
    ? [...(opts.charset ?? DEFAULT_CHARSET)].reverse().join("")
    : (opts.charset ?? DEFAULT_CHARSET);
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
