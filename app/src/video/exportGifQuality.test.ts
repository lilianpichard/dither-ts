import { describe, expect, it } from "vitest";
import { exactFramePalette, resolveExportPalette } from "./exportGif";

function rgba(colours: Array<[number, number, number]>, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colours.length * 4);
  colours.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha;
  });
  return data;
}

describe("exactFramePalette", () => {
  it("returns each distinct colour once", () => {
    const palette = exactFramePalette(
      rgba([
        [10, 20, 30],
        [10, 20, 30],
        [200, 100, 50],
      ]),
    );
    expect(palette).toHaveLength(2);
    expect(palette).toContainEqual([10, 20, 30]);
    expect(palette).toContainEqual([200, 100, 50]);
  });

  it("is exact for a posterised original-mode frame", () => {
    // Four levels per channel is 64 colours, comfortably inside a GIF.
    const colours: Array<[number, number, number]> = [];
    for (const r of [0, 85, 170, 255]) {
      for (const g of [0, 85, 170, 255]) {
        for (const b of [0, 85, 170, 255]) colours.push([r, g, b]);
      }
    }
    const palette = exactFramePalette(rgba(colours));
    expect(palette).not.toBeNull();
    expect(palette).toHaveLength(64);
  });

  it("gives up rather than truncate when there are too many colours", () => {
    // Spread over two channels: a single byte wraps at 256 in a clamped array,
    // which would quietly collapse the count back under the limit.
    const many: Array<[number, number, number]> = [];
    for (let i = 0; i < 300; i++) many.push([i % 256, Math.floor(i / 256), 0]);
    expect(exactFramePalette(rgba(many))).toBeNull();
  });

  it("ignores fully transparent pixels", () => {
    const data = rgba([[1, 2, 3]], 0);
    expect(exactFramePalette(data)).toEqual([]);
  });

  it("does not confuse distinct colours that share bytes", () => {
    const palette = exactFramePalette(
      rgba([
        [1, 2, 3],
        [3, 2, 1],
        [0, 0, 0],
        [255, 255, 255],
      ]),
    );
    expect(palette).toHaveLength(4);
  });
});

describe("resolveExportPalette", () => {
  it("still resolves a named palette for the palette colour mode", () => {
    expect(resolveExportPalette("Gruvbox")).toHaveLength(16);
  });

  it("falls back to greyscale when monochrome", () => {
    expect(resolveExportPalette("Gruvbox", true)).toEqual(resolveExportPalette("B&W"));
  });
});
