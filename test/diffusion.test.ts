import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DIFFUSION_TABLES,
  SPECIAL_DIFFUSION,
  diffuseBW,
  diffusePalette,
  dotDiffusionBW,
  ostromoukhovBW,
  riemersmaBW,
  variableErrorBW,
} from "../src/diffusion.js";
import { thresholdBW } from "../src/pipeline.js";
import { PALETTES } from "../src/palettes.js";
import type { GrayImage, RowProgress } from "../src/types.js";

function gray(values: number[], w: number, h: number): GrayImage {
  return { width: w, height: h, data: new Float32Array(values) };
}

function fill(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v);
}

/** Deterministic patterned fixture: rich enough to separate kernels. */
function fixture(w = 16, h = 16): GrayImage {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = (x * 53 + y * 97 + x * y) % 256;
    }
  }
  return { width: w, height: h, data };
}

function binary(out: Uint8Array): boolean {
  return Array.from(out).every((v) => v === 0 || v === 255);
}

const TABLE_NAMES = Object.keys(DIFFUSION_TABLES);
const SPECIAL_NAMES = Object.keys(SPECIAL_DIFFUSION);

describe("diffusion tables", () => {
  it("registers 9 table kernels with at least 3 taps each", () => {
    assert.equal(TABLE_NAMES.length, 9);
    for (const name of TABLE_NAMES) {
      assert.ok(DIFFUSION_TABLES[name].length >= 3, name);
    }
  });

  it("Sierra-Lite 1x3 [0,128,255] -> [0,0,255]", () => {
    const out = diffuseBW(gray([0, 128, 255], 3, 1), "Sierra-Lite", 128);
    assert.deepEqual(Array.from(out), [0, 0, 255]);
  });

  it("Atkinson 1x3 [200,200,200] -> [255,255,255]", () => {
    const out = diffuseBW(gray([200, 200, 200], 3, 1), "Atkinson", 128);
    assert.deepEqual(Array.from(out), [255, 255, 255]);
  });

  it("every table kernel outputs binary and is deterministic", () => {
    for (const name of TABLE_NAMES) {
      const a = diffuseBW(fixture(), name, 128);
      const b = diffuseBW(fixture(), name, 128);
      assert.ok(binary(a), name);
      assert.deepEqual(Array.from(a), Array.from(b), name);
    }
  });

  it("unknown table name falls back to Floyd-Steinberg", () => {
    const img = fixture();
    assert.deepEqual(
      Array.from(diffuseBW(img, "Nope", 128)),
      Array.from(diffuseBW(img, "Floyd-Steinberg", 128)),
    );
  });
});

describe("special scans", () => {
  it("registers 4 special kernels", () => {
    assert.deepEqual(SPECIAL_NAMES.sort(), [
      "Dot-Diffusion",
      "Ostromoukhov",
      "Riemersma",
      "Variable-Error",
    ]);
  });

  it("Ostromoukhov keeps constant fields constant", () => {
    assert.ok(Array.from(ostromoukhovBW(gray(fill(64, 0), 8, 8), 128)).every((v) => v === 0));
    assert.ok(Array.from(ostromoukhovBW(gray(fill(64, 255), 8, 8), 128)).every((v) => v === 255));
  });

  it("Variable-Error keeps constant fields constant", () => {
    assert.ok(Array.from(variableErrorBW(gray(fill(64, 0), 8, 8), 128)).every((v) => v === 0));
    assert.ok(Array.from(variableErrorBW(gray(fill(64, 255), 8, 8), 128)).every((v) => v === 255));
  });

  it("Riemersma keeps constant fields constant", () => {
    assert.ok(Array.from(riemersmaBW(gray(fill(64, 0), 8, 8), 128)).every((v) => v === 0));
    assert.ok(Array.from(riemersmaBW(gray(fill(64, 255), 8, 8), 128)).every((v) => v === 255));
  });

  it("Dot-Diffusion equals plain threshold by construction", () => {
    const img = fixture();
    assert.deepEqual(Array.from(dotDiffusionBW(img, 128)), Array.from(thresholdBW(img, 128)));
  });

  it("specials output binary and are deterministic", () => {
    const fns = [ostromoukhovBW, variableErrorBW, dotDiffusionBW, riemersmaBW];
    for (const fn of fns) {
      const a = fn(fixture(), 128);
      const b = fn(fixture(), 128);
      assert.ok(binary(a), fn.name);
      assert.deepEqual(Array.from(a), Array.from(b), fn.name);
    }
  });

  it("every diffusion method differs from every other on some fixture", () => {
    // Two kernels can legitimately agree on one image (Sierra and JJN
    // agree on the patterned fixture), so compare across three image
    // classes: patterned, linear sweeps, and a smooth gradient.
    const patterned = fixture();
    const linear = (() => {
      const w = 16;
      const h = 16;
      const data = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) data[y * w + x] = (x * 16 + y * 8) % 256;
      }
      return { width: w, height: h, data };
    })();
    const gradient = (() => {
      const w = 16;
      const h = 16;
      const data = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) data[y * w + x] = Math.floor((255 * (x + y)) / 30);
      }
      return { width: w, height: h, data };
    })();
    const fixtures = [patterned, linear, gradient];
    // Dot-Diffusion is excluded: it equals plain threshold by construction.
    const names = [...TABLE_NAMES, ...SPECIAL_NAMES.filter((n) => n !== "Dot-Diffusion")];
    const run = (img: GrayImage, name: string): string => {
      const out =
        name in DIFFUSION_TABLES ? diffuseBW(img, name, 128) : SPECIAL_DIFFUSION[name](img, 128);
      return Array.from(out).join(",");
    };
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const differ = fixtures.some((img) => run(img, names[i]) !== run(img, names[j]));
        assert.ok(differ, `${names[i]} vs ${names[j]}`);
      }
    }
  });
});

describe("color diffusion", () => {
  function redImage(w = 4, h = 4): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      data[i * 3] = 200;
      data[i * 3 + 1] = 30;
      data[i * 3 + 2] = 30;
    }
    return data;
  }

  function membersOf(out: Uint8ClampedArray, palette: [number, number, number][]): boolean {
    const set = new Set(palette.map((c) => c.join(",")));
    for (let i = 0; i < out.length / 3; i++) {
      if (!set.has(`${out[i * 3]},${out[i * 3 + 1]},${out[i * 3 + 2]}`)) return false;
    }
    return true;
  }

  it("every output pixel is a palette member, deterministic", () => {
    const pal = PALETTES["GameBoy"];
    const a = diffusePalette(redImage(), 4, 4, pal, "Floyd-Steinberg");
    const b = diffusePalette(redImage(), 4, 4, pal, "Floyd-Steinberg");
    assert.ok(membersOf(a, pal));
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  it("Atkinson color path stays in-palette", () => {
    const pal = PALETTES["Pico-8"];
    const out = diffusePalette(redImage(), 4, 4, pal, "Atkinson");
    assert.ok(membersOf(out, pal));
  });

  it("unknown color method falls back to Floyd-Steinberg", () => {
    const pal = PALETTES["GameBoy"];
    assert.deepEqual(
      Array.from(diffusePalette(redImage(), 4, 4, pal, "Nope")),
      Array.from(diffusePalette(redImage(), 4, 4, pal, "Floyd-Steinberg")),
    );
  });
});

describe("row progress hooks", () => {
  it("fires 1..h with matching dims and identical output", () => {
    const img = fixture(9, 7);
    const calls: Array<[number, number, number, number, number]> = [];
    const withHook = diffuseBW(img, "Sierra", 128, (done, total, out, w, h) => {
      calls.push([done, total, out.length, w, h]);
    });
    assert.deepEqual(
      calls.map((c) => [c[0], c[1]]),
      [
        [1, 7],
        [2, 7],
        [3, 7],
        [4, 7],
        [5, 7],
        [6, 7],
        [7, 7],
      ],
    );
    assert.ok(
      calls.every(([, total, len, w, h]) => total === 7 && len === 9 * 7 && w === 9 && h === 7),
    );
    assert.deepEqual(Array.from(withHook), Array.from(diffuseBW(img, "Sierra", 128)));
  });

  it("fires on every kernel family member", () => {
    const img = fixture(6, 5);
    const fns: Array<(o?: RowProgress) => Uint8Array> = [
      (o) => diffuseBW(img, "Floyd-Steinberg", 128, o),
      (o) => ostromoukhovBW(img, 128, o),
      (o) => variableErrorBW(img, 128, o),
      (o) => dotDiffusionBW(img, 128, o),
      (o) => riemersmaBW(img, 128, o),
    ];
    for (const fn of fns) {
      let last = 0;
      let total = 0;
      fn((done, t) => {
        last = done;
        total = t;
      });
      assert.equal(last, total);
      assert.ok(total > 0);
    }
  });
});
