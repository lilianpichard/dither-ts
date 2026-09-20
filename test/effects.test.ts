import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EFFECT_DEFS,
  applyEffect,
  applyEffects,
  defaultEffectParams,
  type EffectInstance,
} from "../src/effects.js";

function rgba(values: number[], w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = values[(i * 3) % values.length];
    out[i * 4 + 1] = values[(i * 3 + 1) % values.length];
    out[i * 4 + 2] = values[(i * 3 + 2) % values.length];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function pattern(w = 8, h = 8): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = (x * 37 + y * 11) % 256;
      out[i + 1] = (x * 91 + y * 53) % 256;
      out[i + 2] = (x * 17 + y * 71) % 256;
      out[i + 3] = 255;
    }
  }
  return out;
}

describe("effect registry", () => {
  it("declares 7 effects with in-range defaults", () => {
    assert.equal(EFFECT_DEFS.length, 7);
    const types = new Set(EFFECT_DEFS.map((d) => d.type));
    assert.equal(types.size, 7);
    for (const def of EFFECT_DEFS) {
      for (const p of def.params) {
        assert.ok(p.def >= p.min && p.def <= p.max, `${def.type}.${p.key}`);
      }
    }
  });

  it("builds default params, empty for unknown types", () => {
    assert.deepEqual(defaultEffectParams("glow"), { radius: 4, intensity: 30 });
    assert.deepEqual(defaultEffectParams("Nope"), {});
  });
});

describe("effect identity cases", () => {
  const cases: Array<[string, Record<string, number>]> = [
    ["glow", { radius: 0, intensity: 30 }],
    ["glow", { radius: 4, intensity: 0 }],
    ["chromatic-aberration", { offset: 0 }],
    ["blur", { radius: 0 }],
    ["sharpen", { amount: 0 }],
    ["scanlines", { pitch: 3, strength: 0 }],
    ["grain", { amount: 0, seed: 1 }],
  ];
  for (const [type, params] of cases) {
    it(`${type} ${JSON.stringify(params)} is a no-op`, () => {
      const src = pattern();
      assert.deepEqual(Array.from(applyEffect(src, 8, 8, type, params)), Array.from(src));
    });
  }

  it("unknown types pass through untouched", () => {
    const src = pattern();
    assert.deepEqual(Array.from(applyEffect(src, 8, 8, "Nope", {})), Array.from(src));
  });

  it("sharpen keeps flat fields flat", () => {
    const src = rgba([128, 128, 128], 4, 4);
    assert.deepEqual(Array.from(applyEffect(src, 4, 4, "sharpen", { amount: 2 })), Array.from(src));
  });
});

describe("effect exact behavior", () => {
  it("glow on flat 128 (r=1, 100%) gives 192", () => {
    const src = rgba([128, 128, 128], 4, 4);
    const out = applyEffect(src, 4, 4, "glow", { radius: 1, intensity: 100 });
    assert.ok(Array.from(out.filter((_, i) => i % 4 !== 3)).every((v) => v === 192));
  });

  it("scanlines darken every pitch-th row fully at strength 100", () => {
    const src = rgba([200, 100, 50], 4, 2);
    const out = applyEffect(src, 4, 2, "scanlines", { pitch: 2, strength: 100 });
    for (let x = 0; x < 4; x++) {
      assert.equal(out[x * 4], 200);
      assert.equal(out[(4 + x) * 4], 0);
      assert.equal(out[(4 + x) * 4 + 1], 0);
      assert.equal(out[(4 + x) * 4 + 2], 0);
    }
  });

  it("aberration shifts R left and B right by the offset", () => {
    // Pixels: red, green, blue.
    const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const out = applyEffect(src, 3, 1, "chromatic-aberration", { offset: 1 });
    // x=1 takes R from x=0 (255) and B from x=2 (255), keeps its G.
    assert.equal(out[4], 255);
    assert.equal(out[5], 255);
    assert.equal(out[6], 255);
  });
});

describe("effect determinism", () => {
  it("seeded effects are stable and seed-sensitive", () => {
    const src = pattern();
    const wide = pattern(16, 16);
    const cases: Array<
      [string, Uint8ClampedArray, Record<string, number>, Record<string, number>]
    > = [
      ["grain", src, { amount: 10, seed: 1 }, { amount: 10, seed: 2 }],
      ["jpeg-glitch", wide, { quality: 50, seed: 1 }, { quality: 50, seed: 2 }],
    ];
    for (const [type, img, a, b] of cases) {
      const w = type === "jpeg-glitch" ? 16 : 8;
      const first = Array.from(applyEffect(img, w, w, type, a));
      const again = Array.from(applyEffect(img, w, w, type, a));
      const other = Array.from(applyEffect(img, w, w, type, b));
      assert.deepEqual(first, again, type);
      assert.notDeepEqual(first, other, type);
    }
  });

  it("jpeg-glitch changes the image at defaults", () => {
    const src = pattern();
    assert.notDeepEqual(
      Array.from(applyEffect(src, 8, 8, "jpeg-glitch", { quality: 50, seed: 1 })),
      Array.from(src),
    );
  });
});

describe("effect chains", () => {
  const on = (type: string): EffectInstance => ({
    type,
    params: defaultEffectParams(type),
    enabled: true,
  });

  it("empty chain copies, disabled entries are skipped", () => {
    const src = pattern();
    assert.deepEqual(Array.from(applyEffects(src, 8, 8, [])), Array.from(src));
    const off: EffectInstance = { ...on("grain"), enabled: false };
    assert.deepEqual(Array.from(applyEffects(src, 8, 8, [off])), Array.from(src));
  });

  it("order matters", () => {
    const src = pattern();
    const a = Array.from(applyEffects(src, 8, 8, [on("glow"), on("blur")]));
    const b = Array.from(applyEffects(src, 8, 8, [on("blur"), on("glow")]));
    assert.notDeepEqual(a, b);
  });

  it("unknown chain entries are no-ops", () => {
    const src = pattern();
    assert.deepEqual(
      Array.from(applyEffects(src, 8, 8, [{ type: "Nope", params: {}, enabled: true }])),
      Array.from(src),
    );
  });
});
