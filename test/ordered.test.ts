import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MATRIX_METHODS,
  PALETTE_ORDERED_GAIN,
  orderedBW,
  orderedField,
  orderedPalette,
} from "../src/ordered.js";
import { blueNoiseMask, crosshatchField, tileMatrix } from "../src/matrices.js";
import { PALETTES } from "../src/palettes.js";
import type { OrderedMethod } from "../src/methods.js";
import type { GrayImage } from "../src/types.js";

function gray(values: number[], w: number, h: number): GrayImage {
  return { width: w, height: h, data: new Float32Array(values) };
}

function fill(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v);
}

const FAMILY: OrderedMethod[] = [...MATRIX_METHODS, "Crosshatch", "Blue-Noise Mask"];

describe("ordered family", () => {
  it("covers 8 matrices plus Crosshatch and Blue-Noise Mask", () => {
    assert.equal(MATRIX_METHODS.length, 8);
    assert.deepEqual(FAMILY.length, 10);
  });

  it("every method outputs binary and varies on flat gray", () => {
    for (const name of FAMILY) {
      const out = orderedBW(gray(fill(64, 128), 8, 8), name, 128);
      assert.ok(
        Array.from(out).every((v) => v === 0 || v === 255),
        name,
      );
      assert.equal(new Set(out).size, 2, name);
    }
  });

  it("threshold 255 degrades to plain threshold (zero gain, strict >)", () => {
    const img = gray([200, 255, 128, 0], 4, 1);
    assert.deepEqual(Array.from(orderedBW(img, "Bayer 4x4", 255)), [0, 0, 0, 0]);
  });

  it("Crosshatch field origin is exactly 128", () => {
    assert.equal(crosshatchField(4, 4)[0][0], 128);
  });

  it("Crosshatch pixel rule on known values", () => {
    assert.equal(orderedBW(gray([200], 1, 1), "Crosshatch", 128)[0], 255);
    assert.equal(orderedBW(gray([100], 1, 1), "Crosshatch", 128)[0], 0);
  });

  it("rejects unknown, inherited, and wrong-family methods", () => {
    const img = gray([10, 200, 130, 90, 250, 5, 77, 180], 4, 2);
    for (const method of ["Nope", "toString", "__proto__", "Floyd-Steinberg"]) {
      const unknown = method as OrderedMethod;
      assert.throws(() => orderedBW(img, unknown, 128), /method/);
      assert.throws(() => orderedField(unknown, 4, 2), /method/);
    }
  });

  it("validates direct kernel inputs", () => {
    assert.throws(() => orderedBW(gray([NaN], 1, 1), "Bayer 4x4", 128));
    assert.throws(() => orderedBW(gray([128], 1, 2), "Bayer 4x4", 128));
    assert.throws(() => orderedBW(gray([128], 1, 1), "Bayer 4x4", NaN));
    assert.throws(() => orderedBW(gray([128], 1, 1), "Bayer 4x4", 128, 0.5));
    assert.throws(() => orderedField("Bayer 4x4", 0, 1));
    assert.throws(() => orderedPalette(new Uint8ClampedArray(2), 1, 1, PALETTES["B&W"]));
    assert.throws(() =>
      orderedPalette(new Uint8ClampedArray(3), 1, 1, [[0, 0, 0]] as [number, number, number][]),
    );
  });

  it("skips masked pixels in ordered grayscale and color kernels", () => {
    const img = gray([200, 170, 180], 3, 1);
    const mask = new Uint8Array([0, 1, 1]);
    assert.equal(orderedBW(img, "Bayer 4x4", 128, 0, mask)[0], 0);

    const rgb = new Uint8ClampedArray([200, 0, 0, 170, 0, 0, 180, 0, 0]);
    const ordered = orderedPalette(rgb, 3, 1, PALETTES["B&W"], "Bayer 4x4", 0, mask);
    assert.deepEqual(Array.from(ordered.slice(0, 3)), [0, 0, 0]);
  });
});

describe("blue noise mask", () => {
  it("is deterministic, in range, centered near 128", () => {
    const a = blueNoiseMask(16, 16);
    const b = blueNoiseMask(16, 16);
    assert.deepEqual(a, b);
    let sum = 0;
    let n = 0;
    for (const row of a) {
      for (const v of row) {
        assert.ok(v >= 0 && v <= 255);
        sum += v;
        n++;
      }
    }
    const mean = sum / n;
    assert.ok(mean > 100 && mean < 156, `mean=${mean}`);
  });
});

describe("tiling", () => {
  it("wraps a 2x2 matrix over 3x3", () => {
    assert.deepEqual(
      tileMatrix(
        [
          [1, 2],
          [3, 4],
        ],
        3,
        3,
      ),
      [
        [1, 2, 1],
        [3, 4, 3],
        [1, 2, 1],
      ],
    );
  });
});

describe("palette ordered", () => {
  it("uses fixed 0.3 gain and stays in-palette", () => {
    assert.equal(PALETTE_ORDERED_GAIN, 0.3);
    const rgb = new Uint8ClampedArray([200, 30, 30, 30, 200, 30, 30, 30, 200, 150, 150, 150]);
    const out = orderedPalette(rgb, 2, 2, PALETTES["GameBoy"], "Bayer 4x4");
    const set = new Set(PALETTES["GameBoy"].map((c) => c.join(",")));
    for (let i = 0; i < 4; i++) {
      assert.ok(set.has(`${out[i * 3]},${out[i * 3 + 1]},${out[i * 3 + 2]}`));
    }
  });

  it("rejects unknown, inherited, and wrong-family methods", () => {
    const rgb = new Uint8ClampedArray([200, 30, 30, 30, 200, 30, 30, 30, 200, 150, 150, 150]);
    for (const method of ["Nope", "toString", "__proto__", "Floyd-Steinberg"]) {
      assert.throws(
        () => orderedPalette(rgb, 2, 2, PALETTES["Pico-8"], method as OrderedMethod),
        /method/,
      );
    }
  });

  it("orderedField resolves every family member to w*h values", () => {
    for (const name of FAMILY) {
      const f = orderedField(name, 5, 4);
      assert.equal(f.length, 4, name);
      assert.equal(f[0].length, 5, name);
    }
  });
});

describe("temporal seed", () => {
  function varied(): GrayImage {
    const w = 8;
    const h = 8;
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = (i * 37) % 256;
    return { width: w, height: h, data };
  }

  it("seed 0 matches the default call", () => {
    const img = varied();
    assert.deepEqual(
      Array.from(orderedBW(img, "Bayer 4x4", 128, 0)),
      Array.from(orderedBW(img, "Bayer 4x4", 128)),
    );
  });

  it("nonzero seeds shift the pattern deterministically", () => {
    const img = varied();
    const a = Array.from(orderedBW(img, "Bayer 4x4", 128, 7));
    const b = Array.from(orderedBW(img, "Bayer 4x4", 128, 7));
    const c = Array.from(orderedBW(img, "Bayer 4x4", 128, 8));
    const ref = Array.from(orderedBW(img, "Bayer 4x4", 128, 0));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, ref);
    assert.notDeepEqual(a, c);
  });

  it("normalizes negative integer seeds", () => {
    const img = varied();
    assert.deepEqual(
      Array.from(orderedBW(img, "Bayer 4x4", 128, -1)),
      Array.from(orderedBW(img, "Bayer 4x4", 128, 4095)),
    );
  });

  it("palette path seeds deterministically too", () => {
    const rgb = new Uint8ClampedArray(8 * 8 * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 53) % 256;
    const a = Array.from(orderedPalette(rgb, 8, 8, PALETTES["GameBoy"], "Bayer 4x4", 3));
    const b = Array.from(orderedPalette(rgb, 8, 8, PALETTES["GameBoy"], "Bayer 4x4", 3));
    const ref = Array.from(orderedPalette(rgb, 8, 8, PALETTES["GameBoy"], "Bayer 4x4", 0));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, ref);
  });
});
