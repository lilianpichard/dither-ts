import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PALETTE,
  ditherColor,
  ditherGray,
  ditherRGBA,
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
import {
  METHOD_NAMES,
  type DitherMethod,
  type DitherRGBAOptions,
  type GrayImage,
  type RGBAImage,
} from "../src/types.js";
import { METHOD_REGISTRY, getMethod } from "../src/methods.js";
import { ditherRGBA as exportedDitherRGBA } from "../src/index.js";

function gray(values: number[], w: number, h: number): GrayImage {
  return { width: w, height: h, data: new Float32Array(values) };
}

function fill(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v);
}

describe("method registry", () => {
  it("lists 24 methods in stable order, None first", () => {
    assert.equal(METHOD_NAMES.length, 24);
    assert.equal(METHOD_NAMES[0], "None");
    assert.equal(METHOD_NAMES[1], "Bayer 2x2");
    assert.equal(METHOD_NAMES[METHOD_NAMES.length - 1], "Blue-Noise Mask");
  });

  it("declares family and B&W/color support", () => {
    assert.deepEqual(METHOD_REGISTRY["Floyd-Steinberg"], {
      family: "diffusion",
      supports: { bw: true, color: true },
    });
    assert.equal(METHOD_REGISTRY["Bayer 4x4"].family, "ordered");
    assert.deepEqual(METHOD_REGISTRY["Riemersma"].supports, { bw: true, color: false });
    assert.ok(Object.isFrozen(METHOD_REGISTRY["Floyd-Steinberg"]));
    assert.ok(Object.isFrozen(METHOD_REGISTRY["Floyd-Steinberg"].supports));
  });

  it("looks up own method names only", () => {
    assert.equal(getMethod("Floyd-Steinberg"), METHOD_REGISTRY["Floyd-Steinberg"]);
    assert.equal(getMethod("toString"), undefined);
    assert.equal(getMethod("__proto__"), undefined);
  });
});

describe("input contracts", () => {
  it("rejects invalid grayscale dimensions and buffer lengths", () => {
    for (const [width, height] of [
      [0, 1],
      [1, 0],
      [-1, 1],
      [1.5, 1],
      [1, Infinity],
    ]) {
      assert.throws(() => ditherGray({ width, height, data: new Float32Array(1) }));
    }
    assert.throws(() => ditherGray(gray([0], 2, 1)));
  });

  it("rejects non-finite or out-of-range grayscale values", () => {
    for (const value of [NaN, Infinity, -Infinity, -0.1, 255.1]) {
      assert.throws(() => ditherGray(gray([value], 1, 1)));
    }
  });

  it("rejects invalid thresholds, pixel sizes, and seeds", () => {
    const img = gray([128], 1, 1);
    for (const threshold of [NaN, Infinity, -Infinity, -1, 256]) {
      assert.throws(() => ditherGray(img, { threshold }));
    }
    for (const pixelSize of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => ditherGray(img, { pixelSize }));
      assert.throws(() => effectivePixelSize(pixelSize));
    }
    for (const seed of [0.5, NaN, Infinity, -Infinity]) {
      assert.throws(() => ditherGray(img, { seed }));
    }
  });

  it("rejects malformed option fields", () => {
    const img = gray([128], 1, 1);
    assert.throws(() => ditherGray(img, null as unknown as Record<string, never>));
    assert.throws(() => ditherGray(img, { method: 1 as unknown as DitherMethod }));
    assert.throws(() => ditherGray(img, { preview: 1 as unknown as boolean }));
    assert.throws(() => ditherGray(img, { onProgress: 1 as unknown as () => void }));
  });

  it("rejects invalid RGB dimensions and buffer lengths", () => {
    assert.throws(() => ditherColor(new Uint8ClampedArray(3), 0, 1));
    assert.throws(() => ditherColor(new Uint8ClampedArray(3), 1.5, 1));
    assert.throws(() => ditherColor(new Uint8ClampedArray(2), 1, 1));
  });
});

describe("ditherGray", () => {
  it("defaults to Floyd-Steinberg on the 1x3 fixture", () => {
    assert.deepEqual(Array.from(ditherGray(gray([0, 128, 255], 3, 1), {})), [0, 0, 255]);
  });

  it("rejects unknown, inherited, and wrong-family methods", () => {
    const img = gray([10, 200, 130, 90], 4, 1);
    for (const method of ["Nope", "toString", "__proto__"]) {
      assert.throws(() => ditherGray(img, { method: method as "Floyd-Steinberg" }));
    }
  });

  it("None passes gray values through untouched at full size", () => {
    const img = gray([10, 200, 130, 90], 4, 1);
    const dimensions: Array<[number, number]> = [];
    const out = ditherGray(img, {
      method: "None",
      threshold: 128,
      pixelSize: 2,
      onProgress: (_done, _total, _data, width, height) => dimensions.push([width, height]),
    });
    assert.deepEqual(Array.from(out), [10, 200, 130, 90]);
    assert.deepEqual(dimensions, [[4, 1]]);
  });

  it("routes every dithering method without crashing", () => {
    const img = gray(fill(64, 100), 8, 8);
    for (const name of METHOD_NAMES) {
      // Mask is ordered-family (covered in ordered tests); None passes through.
      if (name === "Blue-Noise Mask" || name === "None") continue;
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

  it("uses ceiling-sized blocks for nondivisible dimensions", () => {
    const img = gray([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 3);
    const small = downscaleGray(img, 2);
    assert.equal(small.width, 2);
    assert.equal(small.height, 2);
    assert.deepEqual(Array.from(small.data), [1, 3, 7, 9]);
    const out = ditherGray(gray([0, 128, 200], 3, 1), {
      method: "Dot-Diffusion",
      threshold: 0,
      pixelSize: 2,
    });
    assert.deepEqual(Array.from(out), [0, 0, 255]);
    const up = upscaleBW(new Uint8Array([0, 255, 0, 0]), 2, 2, 3, 3);
    assert.deepEqual(Array.from(up), [0, 0, 255, 0, 0, 255, 0, 0, 0]);
  });

  it("validates upscale dimensions and source buffer length", () => {
    assert.throws(() => upscaleBW(new Uint8Array(1), 0, 1, 1, 1), /width and height/);
    assert.throws(() => upscaleBW(new Uint8Array(1), 1, 1, 1.5, 1), /width and height/);
    assert.throws(() => upscaleBW(new Uint8Array(2), 1, 1, 1, 1), /buffer length/);
    assert.throws(() => upscaleBW(new Uint8Array(1), 1, 1, 1, 1, 0), /pixelSize/);
    assert.throws(
      () => upscaleBW(new Uint8Array(1) as unknown as Uint8Array, 1, 1, 1, 1, 1.5),
      /pixelSize/,
    );
    assert.throws(
      () => upscaleBW(new Uint8ClampedArray(1) as unknown as Uint8Array, 1, 1, 1, 1),
      /Uint8Array/,
    );
  });

  it("skips masked pixels in the threshold helper", () => {
    assert.deepEqual(
      Array.from(thresholdBW(gray([200, 170], 2, 1), 128, new Uint8Array([0, 1]) as never)),
      [0, 255],
    );
  });
});

describe("palettes in pipeline", () => {
  it("detects the B&W palette", () => {
    assert.ok(isBWPalette(DEFAULT_PALETTE));
    assert.ok(!isBWPalette(PALETTES["GameBoy"]));
    assert.ok(
      !isBWPalette([
        [0, 0, 0],
        [255, 0, 0],
      ]),
    );
    assert.ok(
      !isBWPalette([
        [0, 0, 0],
        [255, 255, 0],
      ]),
    );
    assert.ok(
      !isBWPalette([
        [0, 0, 0],
        [255, 0, 255],
      ]),
    );
    assert.ok(
      !isBWPalette([
        [0, 255, 0],
        [255, 255, 255],
      ]),
    );
    assert.ok(Object.isFrozen(DEFAULT_PALETTE));
    assert.ok(Object.isFrozen(DEFAULT_PALETTE[0]));
  });

  it("resolves own names and explicit palettes to frozen copies", () => {
    const named = resolvePalette("GameBoy");
    const custom: [number, number, number][] = [
      [1, 2, 3],
      [250, 251, 252],
    ];
    const explicit = resolvePalette(custom);
    assert.deepEqual(named, PALETTES["GameBoy"]);
    assert.deepEqual(explicit, custom);
    assert.notStrictEqual(named, PALETTES["GameBoy"]);
    assert.notStrictEqual(explicit, custom);
    assert.notStrictEqual(named[0], PALETTES["GameBoy"][0]);
    assert.ok(Object.isFrozen(named) && Object.isFrozen(named[0]));
    assert.ok(Object.isFrozen(explicit) && Object.isFrozen(explicit[0]));
    assert.equal(Reflect.set(named, 0, [0, 0, 0]), false);
    assert.equal(Reflect.set(named[0], 0, 0), false);
  });

  it("rejects unknown and inherited palette names", () => {
    for (const name of ["Nope", "toString", "__proto__", "constructor"]) {
      assert.throws(() => resolvePalette(name));
    }
  });

  it("rejects malformed RGB palettes", () => {
    const malformed: unknown[] = [
      null,
      [[0, 0, 0]],
      [
        [0, 0, 0],
        [1, 2],
      ],
      [
        [0, 0, 0],
        [1, 2, NaN],
      ],
      [
        [0, 0, 0],
        [1, 2, 256],
      ],
      [
        [0, 0, 0],
        [1, 2, -1],
      ],
      [
        [0, 0, 0],
        [1, 2, 3.5],
      ],
    ];
    for (const palette of malformed) {
      assert.throws(() => resolvePalette(palette as [number, number, number][]));
    }
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

  it("rejects unknown, inherited, and B&W-only color methods", () => {
    for (const method of ["Nope", "toString", "__proto__", "Riemersma", "Dot-Diffusion"]) {
      assert.throws(() =>
        ditherColor(rgb, 2, 2, { method: method as DitherMethod, palette: "GameBoy" }),
      );
    }
  });

  it("rejects unknown palette names", () => {
    assert.throws(() => ditherColor(rgb, 2, 2, { method: "Bayer 4x4", palette: "Nope" }));
  });

  it("None passes color pixels through untouched at full size", () => {
    const dimensions: Array<[number, number]> = [];
    const out = ditherColor(rgb, 2, 2, {
      method: "None",
      palette: "GameBoy",
      pixelSize: 2,
      onProgress: (_done, _total, _data, width, height) => dimensions.push([width, height]),
    });
    assert.deepEqual(Array.from(out), Array.from(rgb));
    assert.deepEqual(dimensions, [[2, 2]]);
  });

  it("uses ceiling-sized color blocks with exact edges", () => {
    const edge = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const dimensions: Array<[number, number]> = [];
    const out = ditherColor(edge, 3, 1, {
      method: "Floyd-Steinberg",
      palette: "B&W",
      pixelSize: 2,
      onProgress: (_done, _total, _data, width, height) => dimensions.push([width, height]),
    });
    assert.deepEqual(dimensions.at(-1), [2, 1]);
    assert.deepEqual(Array.from(out.slice(0, 3)), Array.from(out.slice(3, 6)));
    assert.notDeepEqual(Array.from(out.slice(0, 3)), Array.from(out.slice(6, 9)));
  });

  it("applies pixel size on color output", () => {
    const big = new Uint8ClampedArray(16 * 3).fill(200);
    const out = ditherColor(big, 4, 4, { method: "Bayer 4x4", palette: "B&W", pixelSize: 2 });
    assert.equal(out.length, 16 * 3);
    assert.ok(membersOf(out, PALETTES["B&W"]));
  });
});

describe("ditherRGBA", () => {
  function rgba(values: number[], width: number, height: number): RGBAImage {
    return { width, height, data: new Uint8ClampedArray(values) };
  }

  it("is exported from the package entry point", () => {
    assert.equal(exportedDitherRGBA, ditherRGBA);
  });

  it("None passes every source byte through untouched", () => {
    const image = rgba([1, 2, 3, 4, 250, 251, 252, 253], 2, 1);
    const out = ditherRGBA(image, { color: true, method: "None", pixelSize: 2 });
    assert.deepEqual(Array.from(out), Array.from(image.data));
  });

  it("packs B&W output and preserves source alpha", () => {
    const options: DitherRGBAOptions = { color: false, method: "Dot-Diffusion", threshold: 128 };
    const out = ditherRGBA(rgba([0, 0, 0, 7, 0, 255, 0, 200], 2, 1), options);
    assert.deepEqual(Array.from(out), [0, 0, 0, 7, 255, 255, 255, 200]);
  });

  it("keeps transparent RGB from affecting visible dithering", () => {
    const make = (transparentRed: number): RGBAImage =>
      rgba([transparentRed, 0, 0, 0, 128, 128, 128, 255], 2, 1);
    const first = ditherRGBA(make(0), { color: true, method: "Floyd-Steinberg", palette: "B&W" });
    const poisoned = ditherRGBA(make(255), {
      color: true,
      method: "Floyd-Steinberg",
      palette: "B&W",
    });
    assert.deepEqual(Array.from(first.slice(4, 7)), Array.from(poisoned.slice(4, 7)));
    assert.deepEqual(Array.from(first.filter((_, index) => index % 4 === 3)), [0, 255]);
    assert.deepEqual(Array.from(poisoned.filter((_, index) => index % 4 === 3)), [0, 255]);
  });

  it("skips transparent grayscale samples without substituting a visible color", () => {
    const make = (transparentRed: number): RGBAImage =>
      rgba([transparentRed, 23, 42, 0, 200, 200, 200, 127, 170, 170, 170, 255], 3, 1);
    const first = ditherRGBA(make(1), { color: false, method: "Floyd-Steinberg" });
    const poisoned = ditherRGBA(make(255), { color: false, method: "Floyd-Steinberg" });
    assert.deepEqual(Array.from(first.slice(0, 4)), [1, 23, 42, 0]);
    assert.deepEqual(Array.from(first.slice(4, 8)), [255, 255, 255, 127]);
    assert.deepEqual(Array.from(first.slice(8)), [255, 255, 255, 255]);
    assert.deepEqual(Array.from(poisoned.slice(0, 4)), [255, 23, 42, 0]);
    assert.deepEqual(Array.from(poisoned.slice(4)), Array.from(first.slice(4)));
  });

  it("skips transparent color samples while preserving partial alpha", () => {
    const make = (transparentRed: number): RGBAImage =>
      rgba([transparentRed, 23, 42, 0, 220, 0, 0, 127, 180, 0, 0, 255], 3, 1);
    const first = ditherRGBA(make(1), {
      color: true,
      method: "Floyd-Steinberg",
      palette: "B&W",
    });
    const poisoned = ditherRGBA(make(255), {
      color: true,
      method: "Floyd-Steinberg",
      palette: "B&W",
    });
    assert.deepEqual(Array.from(first.slice(0, 4)), [1, 23, 42, 0]);
    assert.deepEqual(Array.from(first.filter((_value, index) => index % 4 === 3)), [0, 127, 255]);
    assert.deepEqual(Array.from(poisoned.slice(4)), Array.from(first.slice(4)));
  });

  it("passes the active mask through ordered and special kernels", () => {
    for (const method of ["Bayer 4x4", "Ostromoukhov"] as const) {
      const make = (transparentRed: number): RGBAImage =>
        rgba([transparentRed, 23, 42, 0, 200, 200, 200, 127, 170, 170, 170, 255], 3, 1);
      const first = ditherRGBA(make(1), { color: false, method });
      const poisoned = ditherRGBA(make(255), { color: false, method });
      assert.deepEqual(Array.from(first.slice(0, 4)), [1, 23, 42, 0], method);
      assert.deepEqual(Array.from(first.slice(4)), Array.from(poisoned.slice(4)), method);
    }
  });

  it("preserves partial alpha while ignoring transparent RGB", () => {
    const image = rgba([255, 0, 0, 0, 10, 20, 30, 127, 0, 0, 255, 200], 3, 1);
    const out = ditherRGBA(image, { color: true, method: "Floyd-Steinberg", palette: "B&W" });
    assert.deepEqual(Array.from(out.filter((_, index) => index % 4 === 3)), [0, 127, 200]);
  });

  it("dithers color RGB while preserving source alpha", () => {
    const image = rgba([255, 0, 0, 3, 0, 0, 255, 222], 2, 1);
    const out = ditherRGBA(image, { color: true, method: "Bayer 4x4", palette: "B&W" });
    const palette = new Set(PALETTES["B&W"].map((color) => color.join(",")));
    assert.ok(palette.has(`${out[0]},${out[1]},${out[2]}`));
    assert.ok(palette.has(`${out[4]},${out[5]},${out[6]}`));
    assert.equal(out[3], 3);
    assert.equal(out[7], 222);
  });

  it("preserves exact alpha across working blocks", () => {
    const image = rgba([128, 128, 128, 10, 128, 128, 128, 20, 128, 128, 128, 30], 3, 1);
    const out = ditherRGBA(image, {
      color: false,
      method: "Dot-Diffusion",
      threshold: 0,
      pixelSize: 2,
    });
    assert.deepEqual(Array.from(out.filter((_value, index) => index % 4 === 3)), [10, 20, 30]);
  });

  it("reports working RGBA progress dimensions and preserves final alpha", () => {
    const image = rgba(
      [255, 0, 0, 1, 0, 255, 0, 2, 0, 0, 255, 3, 255, 255, 0, 4, 0, 255, 255, 5, 255, 255, 255, 6],
      3,
      2,
    );
    const frames: Uint8ClampedArray[] = [];
    const dimensions: Array<[number, number]> = [];
    const out = ditherRGBA(image, {
      color: true,
      method: "Bayer 4x4",
      palette: "B&W",
      pixelSize: 2,
      onProgress: (done, total, data, width, height) => {
        assert.equal(data.length, width * height * 4);
        assert.ok(done <= total);
        frames.push(new Uint8ClampedArray(data));
        dimensions.push([width, height]);
      },
    });
    assert.equal(frames.length, 1);
    assert.deepEqual(dimensions, [[2, 1]]);
    assert.deepEqual(Array.from(frames[0].filter((_value, i) => i % 4 === 3)), [1, 3]);
    assert.deepEqual(Array.from(out.filter((_value, i) => i % 4 === 3)), [1, 2, 3, 4, 5, 6]);
  });

  it("rejects malformed RGBA images and options", () => {
    assert.throws(() =>
      ditherRGBA({ width: 0, height: 1, data: new Uint8ClampedArray(4) }, { color: false }),
    );
    assert.throws(() =>
      ditherRGBA({ width: 1, height: 1, data: new Uint8ClampedArray(3) }, { color: false }),
    );
    assert.throws(() =>
      ditherRGBA(rgba([0, 0, 0, 0], 1, 1), { color: "yes" as unknown as boolean }),
    );
  });
});
