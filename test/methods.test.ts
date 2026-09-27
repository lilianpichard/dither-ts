import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METHOD_REGISTRY, greyscaleOnlyMethods, supportsColor } from "../src/index.js";
import type { DitherMethod } from "../src/index.js";

const NAMES = Object.keys(METHOD_REGISTRY) as DitherMethod[];

describe("supportsColor", () => {
  it("reports the variable-error diffusion family as greyscale only", () => {
    for (const name of ["Ostromoukhov", "Variable-Error", "Dot-Diffusion", "Riemersma"]) {
      assert.equal(supportsColor(name as DitherMethod), false, name);
    }
  });

  it("reports every other method as colour capable", () => {
    for (const name of NAMES) {
      if (["Ostromoukhov", "Variable-Error", "Dot-Diffusion", "Riemersma"].includes(name)) continue;
      assert.equal(supportsColor(name), true, name);
    }
  });

  it("agrees with the registry it reads", () => {
    for (const name of NAMES) {
      assert.equal(supportsColor(name), METHOD_REGISTRY[name].supports.color, name);
    }
  });
});

describe("greyscaleOnlyMethods", () => {
  it("lists exactly the four methods with no colour form", () => {
    assert.deepEqual(greyscaleOnlyMethods().sort(), [
      "Dot-Diffusion",
      "Ostromoukhov",
      "Riemersma",
      "Variable-Error",
    ]);
  });

  it("lists each method once", () => {
    const list = greyscaleOnlyMethods();
    assert.equal(new Set(list).size, list.length);
  });

  it("returns a fresh array so a caller cannot corrupt the registry", () => {
    greyscaleOnlyMethods().push("Bayer 4x4");
    assert.equal(supportsColor("Bayer 4x4"), true);
  });
});
