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

  it("caches palette Lab conversions", () => {
    assert.equal(paletteToLab(PALETTES["GameBoy"]), paletteToLab(PALETTES["GameBoy"]));
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
