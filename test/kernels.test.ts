import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BAYER_4x4 } from "../src/matrices.js";
import { floydSteinberg, atkinson, orderedBW } from "../src/kernels.js";

describe("matrices", () => {
  it("Bayer 4x4 top row", () => {
    assert.deepEqual(BAYER_4x4[0], [0, 128, 32, 160]);
  });
});

describe("error diffusion", () => {
  it("Floyd-Steinberg 1x3 [0,128,255] -> [0,0,255] (old > t rule)", () => {
    const out = floydSteinberg(
      { width: 3, height: 1, data: new Float32Array([0, 128, 255]) },
      128
    );
    assert.deepEqual(Array.from(out), [0, 0, 255]);
  });

  it("Atkinson outputs binary and preserves average roughly", () => {
    const w = 8;
    const h = 8;
    const data = new Float32Array(w * h).fill(100);
    const out = atkinson({ width: w, height: h, data }, 128);
    assert.ok(Array.from(out).every((v: number) => v === 0 || v === 255));
    const mean = Array.from(out).reduce((a: number, b: number) => a + b, 0) / out.length / 255;
    assert.ok(mean > 0.15 && mean < 0.65, `mean=${mean}`);
  });

  it("Atkinson differs from Floyd-Steinberg on mid-gray field", () => {
    const w = 16;
    const h = 16;
    const mk = () => ({ width: w, height: h, data: new Float32Array(w * h).fill(129) });
    const a = Array.from(atkinson(mk(), 128));
    const f = Array.from(floydSteinberg(mk(), 128));
    assert.notDeepEqual(a, f);
  });
});

describe("ordered", () => {
  it("outputs binary, varies across pixels on flat gray", () => {
    const w = 4;
    const h = 4;
    const out = orderedBW(
      { width: w, height: h, data: new Float32Array(w * h).fill(128) },
      "Bayer 4x4",
      128
    );
    assert.ok(Array.from(out).every((v: number) => v === 0 || v === 255));
    assert.ok(new Set(out).size === 2);
  });
});
