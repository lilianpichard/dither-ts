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

  it("builds default params and rejects unknown types", () => {
    assert.deepEqual(defaultEffectParams("glow"), { radius: 4, intensity: 30 });
    assert.throws(() => defaultEffectParams("Nope"), /effect/i);
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

  it("rejects unknown and inherited effect types", () => {
    const src = pattern();
    for (const type of ["Nope", "toString", "__proto__", "constructor"]) {
      assert.throws(() => applyEffect(src, 8, 8, type, {}), /effect/i);
    }
  });

  it("keeps partial-alpha bytes exact for no-op and disabled effects", () => {
    const src = new Uint8ClampedArray([1, 2, 3, 127, 250, 251, 252, 1]);
    assert.deepEqual(Array.from(applyEffect(src, 2, 1, "blur", { radius: 0 })), Array.from(src));
    const disabled: EffectInstance = {
      type: "grain",
      params: { amount: 10, seed: 1 },
      enabled: false,
    };
    assert.deepEqual(Array.from(applyEffects(src, 2, 1, [disabled])), Array.from(src));
  });

  it("skips disabled entries before validating their effect definition", () => {
    const src = new Uint8ClampedArray([1, 2, 3, 127]);
    const disabled = { type: "Nope", params: {}, enabled: false } as unknown as EffectInstance;
    assert.deepEqual(Array.from(applyEffects(src, 1, 1, [disabled])), Array.from(src));
  });

  it("keeps a rounded-zero aberration exact", () => {
    const src = new Uint8ClampedArray([1, 2, 3, 127]);
    assert.deepEqual(
      Array.from(applyEffect(src, 1, 1, "chromatic-aberration", { offset: 0.1 })),
      Array.from(src),
    );
  });

  it("keeps transparent RGB from changing visible blur results", () => {
    const make = (transparentRed: number): Uint8ClampedArray =>
      new Uint8ClampedArray([255, 0, 0, 255, transparentRed, 0, 0, 0, 0, 0, 255, 255]);
    const first = applyEffect(make(0), 3, 1, "blur", { radius: 1 });
    const poisoned = applyEffect(make(255), 3, 1, "blur", { radius: 1 });
    assert.deepEqual(Array.from(first.slice(0, 4)), Array.from(poisoned.slice(0, 4)));
    assert.deepEqual(Array.from(first.slice(8, 12)), Array.from(poisoned.slice(8, 12)));
    assert.deepEqual(Array.from(first.filter((_, index) => index % 4 === 3)), [255, 0, 255]);
  });

  it("keeps partial alpha and ignores transparent RGB through effects", () => {
    const make = (transparentRed: number): Uint8ClampedArray =>
      new Uint8ClampedArray([0, 0, 255, 255, transparentRed, 0, 0, 0, 10, 20, 30, 127]);
    const first = applyEffect(make(0), 3, 1, "blur", { radius: 1 });
    const poisoned = applyEffect(make(255), 3, 1, "blur", { radius: 1 });
    assert.deepEqual(Array.from(first.slice(8, 12)), Array.from(poisoned.slice(8, 12)));
    assert.equal(first[11], 127);
    assert.equal(poisoned[11], 127);
  });

  it("sharpen keeps flat fields flat", () => {
    const src = rgba([128, 128, 128], 4, 4);
    assert.deepEqual(Array.from(applyEffect(src, 4, 4, "sharpen", { amount: 2 })), Array.from(src));
  });

  it("blur repeats horizontal and vertical passes and preserves alpha", () => {
    const src = new Uint8ClampedArray([
      0, 0, 0, 1, 100, 20, 30, 2, 0, 0, 0, 3, 0, 0, 0, 4, 200, 40, 60, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0,
      0, 0, 8, 0, 0, 0, 9,
    ]);
    const transposed = new Uint8ClampedArray(src.length);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const source = (y * 3 + x) * 4;
        const target = (x * 3 + y) * 4;
        for (let c = 0; c < 4; c++) transposed[target + c] = src[source + c];
      }
    }
    const out = applyEffect(src, 3, 3, "blur", { radius: 1 });
    const outTransposed = applyEffect(transposed, 3, 3, "blur", { radius: 1 });
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const source = (y * 3 + x) * 4;
        const target = (x * 3 + y) * 4;
        for (let c = 0; c < 3; c++) assert.equal(outTransposed[target + c], out[source + c]);
      }
    }
    for (let i = 3; i < out.length; i += 4) assert.equal(out[i], src[i]);
  });

  it("rejects malformed buffers and non-finite effect parameters", () => {
    const src = pattern(2, 2);
    assert.throws(() => applyEffect(new Uint8ClampedArray(3), 1, 1, "blur", { radius: 1 }));
    assert.throws(() => applyEffect(src, 2, 2, "blur", { radius: Number.NaN }));
    assert.throws(() =>
      applyEffect(src, 2, 2, "grain", { amount: 1, seed: Number.POSITIVE_INFINITY }),
    );
    assert.throws(() => applyEffect(src, 2, 2, "blur", { radius: "1" as unknown as number }));
  });

  it("bounds negative effect values to their no-op limits", () => {
    const src = pattern(4, 4);
    assert.deepEqual(
      Array.from(applyEffect(src, 4, 4, "glow", { radius: 1, intensity: -1 })),
      Array.from(src),
    );
    assert.deepEqual(
      Array.from(applyEffect(src, 4, 4, "chromatic-aberration", { offset: -1 })),
      Array.from(src),
    );
  });

  it("caps effect values at their schema maxima", () => {
    const src = pattern(16, 1);
    const capped = applyEffect(src, 16, 1, "chromatic-aberration", { offset: 12 });
    const oversized = applyEffect(src, 16, 1, "chromatic-aberration", { offset: 100 });
    assert.deepEqual(Array.from(oversized), Array.from(capped));
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

  it("rejects unknown chain entries", () => {
    const src = pattern();
    assert.throws(
      () => applyEffects(src, 8, 8, [{ type: "Nope", params: {}, enabled: true }]),
      /effect/i,
    );
  });

  it("row hooks fire per row with dims and unchanged output", () => {
    const src = pattern(10, 6);
    const calls: Array<[number, number, number, number]> = [];
    const withHook = applyEffects(
      src,
      10,
      6,
      [on("blur"), on("grain")],
      (done, total, out, w, h) => {
        calls.push([done, total, out.length, w]);
        void h;
      },
    );
    assert.deepEqual(
      Array.from(withHook),
      Array.from(applyEffects(src, 10, 6, [on("blur"), on("grain")])),
    );
    // Two effects x six rows each.
    assert.equal(calls.length, 12);
    assert.ok(calls.every(([, total, len, w]) => total === 6 && len === 10 * 6 * 4 && w === 10));
    assert.deepEqual(
      calls.map(([done]) => done),
      [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6],
    );
  });
});
