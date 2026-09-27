import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ditherOriginal, ditherRGBA } from "../src/pipeline.js";
import { rgbToLab } from "../src/color.js";
import type { RGBAImage } from "../src/types.js";

/** A smooth RGB ramp, so a posterising dither has something to chew on. */
function ramp(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      out[i] = Math.round((x / (w - 1)) * 255);
      out[i + 1] = Math.round((y / (h - 1)) * 255);
      out[i + 2] = 128;
    }
  }
  return out;
}

const distinct = (buf: Uint8ClampedArray): number =>
  new Set(Array.from({ length: buf.length / 3 }, (_, p) => buf.slice(p * 3, p * 3 + 3).join(",")))
    .size;

/** Mean Lab hue of the pixels that carry real chroma, in degrees. */
function meanHue(buf: Uint8ClampedArray): number {
  let x = 0;
  let y = 0;
  for (let p = 0; p < buf.length / 3; p++) {
    const [, a, b] = rgbToLab(buf[p * 3], buf[p * 3 + 1], buf[p * 3 + 2]);
    if (Math.hypot(a, b) > 6) {
      x += a;
      y += b;
    }
  }
  return (Math.atan2(y, x) * 180) / Math.PI;
}

const ORDERS = ["Bayer 2x2", "Bayer 4x4", "Bayer 8x8", "Clustered-Dot", "Halftone"] as const;
const DIFFUSION = ["Floyd-Steinberg", "Atkinson", "Sierra"] as const;

describe("ditherOriginal", () => {
  it("keeps the source palette rather than snapping to a fixed one", () => {
    const w = 32;
    const h = 32;
    const src = ramp(w, h);
    const out = ditherOriginal(src, w, h, { method: "Bayer 4x4" });
    assert.equal(out.length, src.length);
    // The point of the mode: many distinct colours survive, so the photo's own
    // palette is intact. A palette-quantised dither would collapse to <=16.
    assert.ok(distinct(out) > 16, `expected a photo palette, got ${distinct(out)} colours`);
  });

  it("holds hue far closer than palette quantisation does", () => {
    const w = 24;
    const h = 24;
    // A saturated orange, the kind of hue a 16-colour palette destroys.
    const src = new Uint8ClampedArray(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      src[i * 3] = 235;
      src[i * 3 + 1] = 120 + (i % 5);
      src[i * 3 + 2] = 30;
    }
    const before = meanHue(src);
    const after = meanHue(ditherOriginal(src, w, h, { method: "Bayer 4x4" }));
    assert.ok(
      Math.abs(after - before) < 12,
      `hue drifted ${Math.abs(after - before).toFixed(1)}deg`,
    );
  });

  it("actually posterises, so the result is fewer colours than the input", () => {
    const w = 32;
    const h = 32;
    const src = ramp(w, h);
    const out = ditherOriginal(src, w, h, { method: "Bayer 4x4" });
    assert.ok(distinct(out) < distinct(src), "expected fewer colours than the source");
  });

  it("runs every ordered and diffusion method without throwing", () => {
    const w = 16;
    const h = 16;
    const src = ramp(w, h);
    for (const method of [...ORDERS, ...DIFFUSION]) {
      const out = ditherOriginal(src, w, h, { method });
      assert.equal(out.length, src.length, `${method} produced the wrong length`);
    }
  });

  it("leaves masked-out pixels at their source colour", () => {
    const w = 8;
    const h = 8;
    const src = new Uint8ClampedArray(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      src[i * 3] = 10;
      src[i * 3 + 1] = 200;
      src[i * 3 + 2] = 90;
    }
    const mask = new Uint8Array(w * h);
    mask[0] = 1; // only the first pixel is active
    const out = ditherOriginal(src, w, h, { method: "Bayer 4x4", mask });
    // Every pixel but the first must come back untouched.
    for (let p = 1; p < w * h; p++) {
      assert.deepEqual(
        Array.from(out.slice(p * 3, p * 3 + 3)),
        [src[p * 3], src[p * 3 + 1], src[p * 3 + 2]],
        `pixel ${p} should have been left alone`,
      );
    }
  });

  it("reports progress once per row", () => {
    const w = 8;
    const h = 8;
    const rows: number[] = [];
    ditherOriginal(ramp(w, h), w, h, {
      method: "Floyd-Steinberg",
      onProgress: (done) => rows.push(done),
    });
    assert.deepEqual(
      rows,
      Array.from({ length: h }, (_, i) => i + 1),
    );
  });

  it("passes the source through untouched for the None method, as the palette path does", () => {
    const w = 4;
    const h = 4;
    const src = ramp(w, h);
    assert.deepEqual(Array.from(ditherOriginal(src, w, h, { method: "None" })), Array.from(src));
  });

  it("rejects a kernel that cannot output colour", () => {
    const w = 4;
    const h = 4;
    // Ostromoukhov is registered bw-only.
    assert.throws(() => ditherOriginal(ramp(w, h), w, h, { method: "Ostromoukhov" }), TypeError);
  });
});

describe("ditherRGBA colorMode", () => {
  const image = (w: number, h: number): RGBAImage => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 220;
      data[i * 4 + 1] = 110;
      data[i * 4 + 2] = 40;
      data[i * 4 + 3] = 255;
    }
    return { width: w, height: h, data };
  };

  it("treats an absent colorMode exactly as palette, so old presets are unchanged", () => {
    const w = 8;
    const h = 8;
    const img = image(w, h);
    const implicit = ditherRGBA(img, { color: true, method: "Bayer 4x4", palette: "Gruvbox" });
    const explicit = ditherRGBA(img, {
      color: true,
      colorMode: "palette",
      method: "Bayer 4x4",
      palette: "Gruvbox",
    });
    assert.deepEqual(Array.from(implicit), Array.from(explicit));
  });

  it("routes colorMode original to the source-colour dither", () => {
    const w = 8;
    const h = 8;
    const img = image(w, h);
    const out = ditherRGBA(img, {
      color: true,
      colorMode: "original",
      method: "Bayer 4x4",
      palette: "Gruvbox",
    });
    const direct = ditherOriginal(
      (() => {
        const rgb = new Uint8ClampedArray(w * h * 3);
        for (let i = 0; i < w * h; i++) {
          rgb[i * 3] = img.data[i * 4];
          rgb[i * 3 + 1] = img.data[i * 4 + 1];
          rgb[i * 3 + 2] = img.data[i * 4 + 2];
        }
        return rgb;
      })(),
      w,
      h,
      { method: "Bayer 4x4" },
    );
    for (let i = 0; i < w * h; i++) {
      assert.deepEqual(
        [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]],
        [direct[i * 3], direct[i * 3 + 1], direct[i * 3 + 2]],
      );
    }
  });

  it("keeps alpha untouched in original mode", () => {
    const w = 4;
    const h = 4;
    const img = image(w, h);
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = 128;
    const out = ditherRGBA(img, { color: true, colorMode: "original", method: "Bayer 4x4" });
    for (let i = 0; i < w * h; i++) assert.equal(out[i * 4 + 3], 128);
  });

  it("rejects an unknown colorMode", () => {
    const w = 4;
    const h = 4;
    assert.throws(
      () => ditherRGBA(image(w, h), { color: true, colorMode: "rainbow" as never }),
      TypeError,
    );
  });
});
