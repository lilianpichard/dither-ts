import { applyEffects, defaultEffectParams } from "../src/effects.js";
import { diffuseBW, diffusePalette, orderedBW, orderedPalette, PALETTES } from "../src/index.js";
import type { GrayImage } from "../src/types.js";

// Load test: representative 1080p workloads with wall-clock timings.
// Measurement only — no assertions, keep out of CI budgets.
function patternRGBA(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = (i * 37) % 256;
    out[i * 4 + 1] = (i * 91) % 256;
    out[i * 4 + 2] = (i * 17) % 256;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function grayImage(w: number, h: number): GrayImage {
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (i * 53) % 256;
  return { width: w, height: h, data };
}

function bench(label: string, fn: () => void): void {
  fn(); // warmup
  const t0 = performance.now();
  fn();
  console.log(`${label}: ${Math.round(performance.now() - t0)}ms`);
}

const W = 1920;
const H = 1080;
const src = patternRGBA(W, H);
const gray = grayImage(W, H);

for (const radius of [2, 10, 20]) {
  bench(`blur r=${radius} @1080p`, () => {
    applyEffects(src, W, H, [{ type: "blur", params: { radius }, enabled: true }]);
  });
}
bench("glow default @1080p", () => {
  applyEffects(src, W, H, [{ type: "glow", params: defaultEffectParams("glow"), enabled: true }]);
});
bench("glow+sharpen @1080p", () => {
  applyEffects(src, W, H, [
    { type: "glow", params: defaultEffectParams("glow"), enabled: true },
    { type: "sharpen", params: defaultEffectParams("sharpen"), enabled: true },
  ]);
});
bench("Floyd-Steinberg @1080p", () => {
  diffuseBW(gray, "Floyd-Steinberg", 128);
});
bench("Floyd-Steinberg hook-on @1080p", () => {
  diffuseBW(gray, "Floyd-Steinberg", 128, () => {});
});
bench("ordered Bayer 4x4 @1080p", () => {
  orderedBW(gray, "Bayer 4x4", 128);
});
bench("grain @1080p", () => {
  applyEffects(src, W, H, [{ type: "grain", params: defaultEffectParams("grain"), enabled: true }]);
});

const SW = 960;
const SH = 540;
const small = new Uint8ClampedArray(SW * SH * 3);
for (let i = 0; i < small.length; i++) small[i] = (i * 37) % 256;
bench("orderedPalette Pico-8 @540p", () => {
  orderedPalette(small, SW, SH, PALETTES["Pico-8"], "Bayer 4x4");
});
bench("diffusePalette FS Pico-8 @540p", () => {
  diffusePalette(small, SW, SH, PALETTES["Pico-8"], "Floyd-Steinberg");
});
