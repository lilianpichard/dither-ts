import { describe, expect, it } from "vitest";
import { planMaxDim, previewSize, type ClipInfo } from "./jobs";
import { cappedPixelSize, exportPixelSize, previewPixelSize } from "./pixelSize";

const CLIP: ClipInfo = { width: 2048, height: 1080, duration: 2 };
const IMAGE = { width: 4000, height: 3000 };

describe("the sizes each path renders at", () => {
  it("previews video below the clip and exports at or above it", () => {
    // The reported case: a 2048x1080 clip, preview at 1080x570, export at full.
    expect(previewSize(CLIP, "Bayer 4x4")).toEqual({ width: 1080, height: 570 });
    expect(planMaxDim("Bayer 4x4")).toBe(1080);
    // A diffusion scan is capped lower, so its block drifts further unscaled.
    expect(planMaxDim("Floyd-Steinberg")).toBe(720);
  });

  it("caps a still only for the heavy scans", () => {
    // The rail shows one size; the export uses the source's own.
    expect(previewSize({ ...CLIP, ...IMAGE }, "Bayer 4x4")).toEqual({ width: 1080, height: 810 });
    // The heavy cap is 720 on the long edge, short of the 1080 the light
    // methods get, so a heavy scan previews smaller and drifts further.
    expect(previewSize({ ...CLIP, ...IMAGE }, "Stucki")).toEqual({ width: 720, height: 540 });
  });
});

describe("previewPixelSize", () => {
  it("scales the block down with the frame", () => {
    const frame = previewSize(CLIP, "Bayer 4x4");
    // 2 source pixels per block, rendered on a frame half the size.
    expect(previewPixelSize({ pixelSize: 2 }, CLIP, frame)).toBe(1);
    expect(previewPixelSize({ pixelSize: 4 }, CLIP, frame)).toBe(2);
    expect(previewPixelSize({ pixelSize: 3 }, CLIP, frame)).toBe(2);
  });

  it("is the identity when the preview is the clip's own size", () => {
    // A small clip is never capped, so nothing should change.
    const small = { width: 640, height: 480 };
    expect(previewPixelSize({ pixelSize: 3 }, small, small)).toBe(3);
  });

  it("keeps the block's share of the frame close to the export's", () => {
    for (const method of ["Bayer 4x4", "Floyd-Steinberg"]) {
      const frame = previewSize(CLIP, method);
      for (const pixelSize of [2, 3, 4, 8]) {
        const factor = previewPixelSize({ pixelSize }, CLIP, frame);
        const previewBlocks = Math.max(frame.width, frame.height) / factor;
        const exportBlocks = CLIP.width / pixelSize;
        const drift = Math.abs(previewBlocks - exportBlocks) / exportBlocks;
        // One pixel of rounding on each side. Before the scaling the drift was
        // the full ratio between the two sizes.
        expect(drift).toBeLessThanOrEqual(1 / factor + 1 / pixelSize);
      }
    }
  });
});

describe("exportPixelSize", () => {
  it("is the identity at the clip's own size", () => {
    expect(exportPixelSize({ pixelSize: 3 }, CLIP, CLIP)).toBe(3);
  });

  it("grows the block when full resolution is asked for", () => {
    // Upsampling keeps the share, so the block grows with the frame.
    const upscaled = { width: 4096, height: 2160 };
    expect(exportPixelSize({ pixelSize: 2 }, CLIP, upscaled)).toBe(4);
  });
});

describe("cappedPixelSize", () => {
  it("scales a still preview that was capped for a heavy scan", () => {
    expect(cappedPixelSize({ pixelSize: 4 }, { width: 960, height: 720 }, IMAGE)).toBe(1);
    expect(cappedPixelSize({ pixelSize: 2 }, { width: 1080, height: 810 }, IMAGE)).toBe(1);
  });

  it("is the identity for a still that was never capped", () => {
    expect(cappedPixelSize({ pixelSize: 3 }, IMAGE, IMAGE)).toBe(3);
  });
});
