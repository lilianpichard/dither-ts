import { describe, expect, it } from "vitest";
import { PALETTES, type RGB } from "../../../src/index.js";
import {
  DEFAULT_CUSTOM_COLORS,
  MAX_PALETTE_COLORS,
  MIN_PALETTE_COLORS,
  activeColors,
  addColor,
  draftColors,
  editColor,
  hexToRgb,
  isActivePalette,
  isCustomPalette,
  normalizeHex,
  removeColor,
  rgbToHex,
} from "./editor";

const trio: RGB[] = [
  [0, 0, 0],
  [128, 128, 128],
  [255, 255, 255],
];

describe("hex parsing", () => {
  it("normalizes shorthand, case, and surrounding space", () => {
    expect(normalizeHex(" #AbC ")).toBe("#aabbcc");
    expect(normalizeHex("FF0000")).toBe("#ff0000");
    expect(normalizeHex("not a colour")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("round-trips between hex and RGB", () => {
    expect(hexToRgb("#0a141e")).toEqual([10, 20, 30]);
    expect(hexToRgb("#0a1")).toEqual([0, 170, 17]);
    expect(hexToRgb("#0a14")).toBeNull();
    expect(rgbToHex([10, 20, 30])).toBe("#0a141e");
    expect(hexToRgb(rgbToHex([0, 128, 255]))).toEqual([0, 128, 255]);
  });
});

describe("palette resolution", () => {
  it("reads built-in and custom palettes", () => {
    expect(isCustomPalette("GameBoy")).toBe(false);
    expect(isCustomPalette(trio)).toBe(true);
    expect(activeColors("GameBoy")).toEqual(PALETTES.GameBoy);
    expect(activeColors("Nope")).toEqual([]);
    expect(activeColors(trio)).toBe(trio);
  });

  it("starts a draft from the live palette or a built-in copy", () => {
    expect(draftColors(trio)).toEqual(trio);
    expect(draftColors(trio)).not.toBe(trio);
    expect(draftColors("GameBoy")).toEqual(PALETTES.GameBoy);
    expect(draftColors("Missing")).toEqual(DEFAULT_CUSTOM_COLORS);
  });

  it("does not resolve an inherited key as a palette", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(activeColors(name)).toEqual([]);
      expect(draftColors(name)).toEqual(DEFAULT_CUSTOM_COLORS);
    }
  });
});

describe("editing a custom palette", () => {
  it("appends a valid, new colour", () => {
    expect(addColor(trio, "#ff0000")).toHaveLength(4);
    expect(addColor(trio, "#ff0000")[3]).toEqual([255, 0, 0]);
  });

  it("rejects invalid, duplicate, and over-long additions", () => {
    expect(addColor(trio, "nope")).toBe(trio);
    expect(addColor(trio, "#000000")).toBe(trio);
    const full = Array.from({ length: MAX_PALETTE_COLORS }, (_, i): RGB => [i, i, i]);
    expect(addColor(full, "#ffffff")).toBe(full);
  });

  it("keeps at least two colours", () => {
    const pair: RGB[] = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    expect(removeColor(pair, 0)).toBe(pair);
    expect(removeColor(pair, 5)).toBe(pair);
    expect(removeColor(trio, 1)).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });

  it("edits one swatch in place", () => {
    expect(editColor(trio, 1, "#010203")).toEqual([
      [0, 0, 0],
      [1, 2, 3],
      [255, 255, 255],
    ]);
    expect(editColor(trio, 1, "zzz")).toBe(trio);
    expect(editColor(trio, 9, "#010203")).toBe(trio);
  });

  it("knows when the draft is already the active palette", () => {
    expect(isActivePalette(trio, trio)).toBe(true);
    expect(isActivePalette(trio, addColor(trio, "#ff0000"))).toBe(false);
    expect(isActivePalette("GameBoy", PALETTES.GameBoy)).toBe(false);
  });
});

describe("bounds", () => {
  it("matches the preset format window", () => {
    expect(MIN_PALETTE_COLORS).toBe(2);
    expect(MAX_PALETTE_COLORS).toBe(16);
  });
});
