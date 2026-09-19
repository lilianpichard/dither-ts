import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PALETTE,
  ditherColor,
  ditherGray,
  downscaleGray,
  effectivePixelSize,
  isBWPalette,
  resolvePalette,
  thresholdBW,
  upscaleBW,
} from "../src/pipeline.js";
import { orderedPalette } from "../src/ordered.js";
import { diffusePalette } from "../src/diffusion.js";
import { PALETTES } from "../src/palettes.js";
import { METHOD_NAMES, type GrayImage } from "../src/types.js";

function gray(values: number[], w: number, h: number): GrayImage {
  return { width: w, height: h, data: new Float32Array(values) };
}

function fill(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v);
}

describe("method registry", () => {
  it("lists 23 methods in stable order", () => {
    assert.equal(METHOD_NAMES.length, 23);
    assert.equal(METHOD_NAMES[0], "Bayer 2x2");
    assert.equal(METHOD_NAMES[METHOD_NAMES.length - 1], "Blue-Noise Mask");
  });
});

describe("ditherGray", () => {
  it("defaults to Floyd-Steinberg on the 1x3 fixture", () => {
    assert.deepEqual(Array.from(ditherGray(gray([0, 128, 255], 3, 1), {})), [0, 0, 255]);
  });

  it("routes unknown methods to plain threshold", () => {
    const img = gray([10, 200, 130, 90], 4, 1);
    assert.deepEqual(
      Array.from(ditherGray(img, { method: "Nope", threshold: 128 })),
      Array.from(thresholdBW(img, 128)),
    );
  });

  it("routes every diffusion method without crashing", () => {
    const img = gray(fill(64, 100), 8, 8);
    for (const name of METHOD_NAMES) {
      if (name === "Blue-Noise Mask") continue; // ordered-family, covered below
      const out = ditherGray(img, { method: name, threshold: 128 });
      assert.equal(out.length, 64, name);
      assert.ok(
        Array.from(out).every((v) => v === 0 || v === 255),
        name,
      );
    }
  });

  it("applies pixel size (downscale-dither-upscale)", () => {
    const img = gray(fill(16, 200), 4, 4);
    const out = ditherGray(img, { method: "Floyd-Steinberg", threshold: 128, pixelSize: 2 });
    assert.equal(out.length, 16);
    assert.ok(Array.from(out).every((v) => v === 255));
  });

  it("preview doubles the effective pixel size", () => {
    assert.equal(effectivePixelSize(1, false), 1);
    assert.equal(effectivePixelSize(2, false), 2);
    assert.equal(effectivePixelSize(2, true), 4);
  });

  it("downscale/upscale round-trip sizes", () => {
    const img = gray([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3);
    const small = downscaleGray(img, 2);
    assert.equal(small.width, 1);
    assert.equal(small.height, 1);
    const up = upscaleBW(new Uint8Array([255]), 1, 1, 3, 3);
    assert.ok(Array.from(up).every((v) => v === 255));
  });
});

describe("palettes in pipeline", () => {
  it("detects the B&W palette", () => {
    assert.ok(isBWPalette(DEFAULT_PALETTE));
    assert.ok(!isBWPalette(PALETTES["GameBoy"]));
  });

  it("resolves names, arrays, and bad input", () => {
    assert.equal(resolvePalette("GameBoy"), PALETTES["GameBoy"]);
    assert.equal(resolvePalette("Nope"), PALETTES["B&W"]);
    const custom: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    assert.equal(resolvePalette(custom), custom);
    assert.equal(resolvePalette([[1, 2, 3]]), PALETTES["B&W"]);
  });
});

describe("ditherColor", () => {
  const rgb = new Uint8ClampedArray([200, 30, 30, 30, 200, 30, 30, 30, 200, 150, 150, 150]);

  function membersOf(out: Uint8ClampedArray, pal: [number, number, number][]): boolean {
    const set = new Set(pal.map((c) => c.join(",")));
    for (let i = 0; i < out.length / 3; i++) {
      if (!set.has(`${out[i * 3]},${out[i * 3 + 1]},${out[i * 3 + 2]}`)) return false;
    }
    return true;
  }

  it("routes ordered methods to the ordered palette path", () => {
    assert.deepEqual(
      Array.from(ditherColor(rgb, 2, 2, { method: "Bayer 4x4", palette: "GameBoy" })),
      Array.from(orderedPalette(rgb, 2, 2, PALETTES["GameBoy"], "Bayer 4x4")),
    );
  });

  it("routes diffusion methods to the Lab palette path", () => {
    assert.deepEqual(
      Array.from(ditherColor(rgb, 2, 2, { method: "Floyd-Steinberg", palette: "GameBoy" })),
      Array.from(diffusePalette(rgb, 2, 2, PALETTES["GameBoy"], "Floyd-Steinberg")),
    );
  });

  it("falls back to Floyd-Steinberg for unknown methods", () => {
    assert.deepEqual(
      Array.from(ditherColor(rgb, 2, 2, { method: "Nope", palette: "GameBoy" })),
      Array.from(ditherColor(rgb, 2, 2, { method: "Floyd-Steinberg", palette: "GameBoy" })),
    );
  });

  it("unknown palette names resolve to B&W output", () => {
    const out = ditherColor(rgb, 2, 2, { method: "Bayer 4x4", palette: "Nope" });
    assert.ok(membersOf(out, PALETTES["B&W"]));
  });

  it("applies pixel size on color output", () => {
    const big = new Uint8ClampedArray(16 * 3).fill(200);
    const out = ditherColor(big, 4, 4, { method: "Bayer 4x4", palette: "B&W", pixelSize: 2 });
    assert.equal(out.length, 16 * 3);
    assert.ok(membersOf(out, PALETTES["B&W"]));
  });
});
