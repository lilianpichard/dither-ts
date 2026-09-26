import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nearestLabIndex, nearestRGBIndex, paletteToLab, rgbToLab } from "../src/color.js";
import { PALETTES } from "../src/palettes.js";

function close(actual: number, expected: number, tol: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected}`);
}

describe("rgbToLab", () => {
  it("maps black to origin", () => {
    assert.deepEqual(rgbToLab(0, 0, 0), [0, 0, 0]);
  });

  it("maps white to L=100, neutral chroma", () => {
    const [l, a, b] = rgbToLab(255, 255, 255);
    close(l, 100, 0.01, "L");
    close(a, 0, 0.01, "a");
    close(b, 0, 0.01, "b");
  });

  it("maps pure red to the reference Lab triple", () => {
    const [l, a, b] = rgbToLab(255, 0, 0);
    close(l, 53.24, 0.6, "L");
    close(a, 80.11, 0.6, "a");
    close(b, 67.22, 0.6, "b");
  });

  it("linearizes fractional accumulated channels without rounding", () => {
    const actual = rgbToLab(127.5, 64.25, 191.75);
    const linear = (value: number): number => {
      const c = value / 255;
      return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
    };
    const lr = linear(127.5);
    const lg = linear(64.25);
    const lb = linear(191.75);
    const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.9505;
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.089;
    const f = (value: number): number =>
      value > 0.008856 ? Math.cbrt(value) : (903.3 * value + 16) / 116;
    const expected = [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-12);
  });
});

describe("nearest color", () => {
  it("finds black for red in B&W (RGB space)", () => {
    assert.equal(nearestRGBIndex(255, 0, 0, PALETTES["B&W"]), 0);
  });

  it("finds the exact Pico-8 red triple", () => {
    assert.equal(nearestRGBIndex(255, 0, 77, PALETTES["Pico-8"]), 8);
  });

  it("finds white for white in Lab space", () => {
    const lab = paletteToLab(PALETTES["B&W"]);
    assert.equal(nearestLabIndex(rgbToLab(255, 255, 255), lab), 1);
  });

  it("rejects empty and malformed RGB palettes", () => {
    assert.throws(() => nearestRGBIndex(0, 0, 0, []), /empty/i);
    assert.throws(
      () =>
        nearestRGBIndex(0, 0, 0, [
          [0, 0, 0],
          [1, 2],
        ] as [number, number, number][]),
      /palette/i,
    );
    assert.throws(
      () =>
        nearestRGBIndex(0, 0, 0, [
          [0, 0, 0],
          [1, 2, Number.NaN],
        ] as [number, number, number][]),
      /palette/i,
    );
  });

  it("rejects malformed Lab inputs and palettes", () => {
    assert.throws(() => nearestLabIndex(rgbToLab(0, 0, 0), []), /empty/i);
    assert.throws(
      () =>
        nearestLabIndex(rgbToLab(0, 0, 0), [
          [0, 0, 0],
          [1, 2],
        ] as unknown as [number, number, number][]),
      /lab|palette/i,
    );
    assert.throws(
      () =>
        nearestLabIndex(rgbToLab(0, 0, 0), [
          [0, Number.NaN, 0],
          [1, 2, 3],
        ]),
      /lab|palette/i,
    );
    assert.throws(
      () => nearestLabIndex([0, 0] as unknown as [number, number, number], [[0, 0, 0]]),
      /lab/i,
    );
  });

  it("returns mutation-isolated palette Lab conversions", () => {
    const first = paletteToLab(PALETTES["B&W"]);
    first[0][0] = 999;
    first.length = 0;
    const second = paletteToLab(PALETTES["B&W"]);
    assert.notStrictEqual(first, second);
    assert.deepEqual(second, [
      [0, 0, 0],
      [100, 0, 0],
    ]);
  });

  it("stays correct across bounded-cache churn", () => {
    for (let i = 0; i < 80; i++) {
      const palette: [number, number, number][] = [
        [i, i, i],
        [255 - i, 255 - i, 255 - i],
      ];
      assert.equal(paletteToLab(palette).length, 2);
    }
  });
});

describe("palettes", () => {
  it("registers 11 valid palettes", () => {
    const names = Object.keys(PALETTES);
    assert.equal(names.length, 11);
    for (const name of names) {
      const pal = PALETTES[name];
      assert.ok(pal.length >= 2, name);
      for (const c of pal) {
        assert.equal(c.length, 3, name);
        for (const v of c) {
          assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${name}: ${v}`);
        }
      }
    }
  });
});
