import { describe, expect, it } from "vitest";
import {
  MAX_DIFFUSION_DIM,
  MAX_FULL_RES_DIM,
  MAX_ORDERED_DIM,
  MAX_VIDEO_FRAMES,
  clampRange,
  fitSize,
  isHeavyMethod,
  isOrderedMethod,
  planFrames,
  planMaxDim,
  previewSize,
} from "./jobs";

describe("frame planner", () => {
  it("classifies ordered vs diffusion methods", () => {
    expect(isOrderedMethod("Bayer 4x4")).toBe(true);
    expect(isOrderedMethod("Crosshatch")).toBe(true);
    expect(isOrderedMethod("Blue-Noise Mask")).toBe(true);
    expect(isOrderedMethod("None")).toBe(true);
    expect(isOrderedMethod("Floyd-Steinberg")).toBe(false);
    expect(isOrderedMethod("Riemersma")).toBe(false);
  });

  it("flags heavy scans for preview caps", () => {
    expect(isHeavyMethod("Riemersma")).toBe(true);
    expect(isHeavyMethod("Stevenson-Arce")).toBe(true);
    expect(isHeavyMethod("Floyd-Steinberg")).toBe(false);
    expect(isHeavyMethod("Bayer 4x4")).toBe(false);
  });

  it("keeps small clips at native size", () => {
    expect(fitSize(640, 480, 720)).toEqual({ width: 640, height: 480 });
  });

  it("caps the long edge, even dimensions, aspect preserved", () => {
    const capped = fitSize(1920, 1080, 720);
    expect(capped.width).toBe(720);
    expect(capped.height % 2).toBe(0);
    expect(Math.abs(capped.height - 405)).toBeLessThanOrEqual(1);
  });

  it("samples fps * span frames ascending inside the range", () => {
    const plan = planFrames(
      { duration: 10, width: 640, height: 480 },
      { start: 2, end: 4 },
      10,
      "Bayer 4x4",
    );
    expect(plan.times.length).toBe(20);
    expect(plan.times[0]).toBe(2);
    expect(plan.times[plan.times.length - 1]).toBeLessThan(4);
    expect(plan.fps).toBe(10);
  });

  it("clamps range and fps to sane values", () => {
    const plan = planFrames(
      { duration: 5, width: 640, height: 480 },
      { start: 0, end: 5 },
      500,
      "Stucki",
    );
    expect(plan.times.length).toBeLessThanOrEqual(5 * 30);
    expect(plan.times[0]).toBeGreaterThanOrEqual(0);
    expect(plan.times[plan.times.length - 1]).toBeLessThanOrEqual(5);
    expect(plan.width).toBeLessThanOrEqual(720);
  });

  it("always yields at least one frame", () => {
    const plan = planFrames(
      { duration: 5, width: 64, height: 64 },
      { start: 2, end: 2 },
      10,
      "Bayer 4x4",
    );
    expect(plan.times.length).toBe(1);
  });

  it("rejects non-finite dimensions and invalid ranges", () => {
    expect(() =>
      planFrames(
        { duration: 5, width: Number.POSITIVE_INFINITY, height: 100 },
        { start: 0, end: 1 },
        10,
        "None",
      ),
    ).toThrow(/width.*height.*finite/i);
    expect(() =>
      planFrames({ duration: 5, width: 100, height: 100 }, { start: 2, end: 1 }, 10, "None"),
    ).toThrow(/range/i);
  });

  it("accepts the frame-count boundary and bounds FPS", () => {
    const plan = planFrames(
      { duration: 120, width: 100, height: 100 },
      { start: 0, end: 120 },
      500,
      "None",
    );
    expect(plan.times).toHaveLength(MAX_VIDEO_FRAMES);
    expect(plan.fps).toBe(30);
    expect(() =>
      planFrames(
        { duration: 5, width: 100, height: 100 },
        { start: 0, end: 1 },
        Number.POSITIVE_INFINITY,
        "None",
      ),
    ).toThrow(/fps/i);
  });

  it("rejects unsafe frame counts instead of truncating them", () => {
    expect(() =>
      planFrames(
        { duration: 1000, width: 100, height: 100 },
        { start: 0, end: MAX_VIDEO_FRAMES / 30 + 0.01 },
        30,
        "None",
      ),
    ).toThrow(/maximum is 3600/);
  });
});

describe("preview sizing", () => {
  const LONG = { duration: 1800, width: 1920, height: 1080 };

  it("matches the method cap that planFrames would have used", () => {
    const clip = { duration: 10, width: 1920, height: 1080 };
    const planned = planFrames(clip, { start: 0, end: 1 }, 10, "Bayer 4x4");
    expect(previewSize(clip, "Bayer 4x4")).toEqual({
      width: planned.width,
      height: planned.height,
    });
  });

  it("sizes a clip too long to export, which is the whole point", () => {
    // planFrames rejects this range on the frame ceiling; a preview must not.
    expect(() => planFrames(LONG, { start: 0, end: LONG.duration }, 30, "Bayer 4x4")).toThrow(
      /maximum is 3600/,
    );
    expect(previewSize(LONG, "Bayer 4x4")).toEqual({ width: 1080, height: 608 });
  });

  it("applies the diffusion cap the same way", () => {
    expect(previewSize(LONG, "Floyd-Steinberg").width).toBe(720);
  });
});

describe("plan resolution options", () => {
  const UHD = { duration: 10, width: 3840, height: 2160 };

  it("defaults to the method cap when no option is given", () => {
    expect(planMaxDim("Bayer 4x4")).toBe(MAX_ORDERED_DIM);
    expect(planMaxDim("Floyd-Steinberg")).toBe(MAX_DIFFUSION_DIM);
  });

  it("lets an explicit cap win over the method default", () => {
    expect(planMaxDim("Bayer 4x4", 2160)).toBe(2160);
    expect(planMaxDim("Floyd-Steinberg", MAX_FULL_RES_DIM)).toBe(MAX_FULL_RES_DIM);
  });

  it("rejects an unusable cap instead of silently falling back", () => {
    expect(() => planMaxDim("Bayer 4x4", 0)).toThrow(/maxDim/);
    expect(() => planMaxDim("Bayer 4x4", -100)).toThrow(/maxDim/);
    expect(() => planMaxDim("Bayer 4x4", 12.5)).toThrow(/maxDim/);
    expect(() => planMaxDim("Bayer 4x4", Number.NaN)).toThrow(/maxDim/);
  });

  it("leaves the default plan size untouched", () => {
    const plan = planFrames(UHD, { start: 0, end: 1 }, 10, "Bayer 4x4");
    expect(plan.width).toBe(MAX_ORDERED_DIM);
  });

  it("exports at native size when the source fits the full-res cap", () => {
    const plan = planFrames(
      { duration: 10, width: 640, height: 480 },
      { start: 0, end: 1 },
      10,
      "Floyd-Steinberg",
      { maxDim: MAX_FULL_RES_DIM },
    );
    expect(plan).toMatchObject({ width: 640, height: 480 });
  });

  it("clamps a huge source to the hard safety cap", () => {
    const plan = planFrames(
      { duration: 10, width: 8000, height: 4000 },
      { start: 0, end: 1 },
      10,
      "Floyd-Steinberg",
      { maxDim: MAX_FULL_RES_DIM },
    );
    expect(plan.width).toBe(MAX_FULL_RES_DIM);
    expect(plan.height).toBeLessThanOrEqual(MAX_FULL_RES_DIM);
  });

  it("keeps a full-res plan even dimensions, unlike the method cap", () => {
    const plan = planFrames(UHD, { start: 0, end: 1 }, 10, "Riemersma", {
      maxDim: MAX_FULL_RES_DIM,
    });
    expect(plan.width).toBe(3840);
    expect(plan.height).toBe(2160);
    expect(plan.width).toBeGreaterThan(MAX_DIFFUSION_DIM);
  });

  it("resizing is the only difference between the capped and full-res plans", () => {
    const clip = { duration: 10, width: 1920, height: 1080 };
    const range = { start: 1, end: 3 };
    const capped = planFrames(clip, range, 12, "Floyd-Steinberg");
    const full = planFrames(clip, range, 12, "Floyd-Steinberg", { maxDim: MAX_FULL_RES_DIM });
    expect(full.times).toEqual(capped.times);
    expect(full.fps).toBe(capped.fps);
    expect(full).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("in/out range clamping", () => {
  it("keeps a valid range untouched", () => {
    expect(clampRange({ start: 1, end: 4 }, 10)).toEqual({ start: 1, end: 4 });
    expect(clampRange({ start: 0, end: 0 }, 10)).toEqual({ start: 0, end: 0 });
  });

  it("clamps points outside the clip", () => {
    expect(clampRange({ start: -5, end: 99 }, 10)).toEqual({ start: 0, end: 10 });
  });

  it("repairs an inverted range by pushing the out point along", () => {
    expect(clampRange({ start: 6, end: 2 }, 10)).toEqual({ start: 6, end: 6 });
  });

  it("falls back for empty or non-numeric fields", () => {
    expect(clampRange({ start: Number.NaN, end: 4 }, 10)).toEqual({ start: 0, end: 4 });
    expect(clampRange({ start: 2, end: Number.NaN }, 10)).toEqual({ start: 2, end: 10 });
    expect(clampRange({ start: Number.NaN, end: Number.NaN }, 10)).toEqual({ start: 0, end: 10 });
  });

  it("survives a missing duration and never yields a range planFrames rejects", () => {
    expect(clampRange({ start: 3, end: 7 }, 0)).toEqual({ start: 0, end: 0 });
    for (const duration of [0, Number.NaN]) {
      for (const range of [
        { start: -1, end: 9 },
        { start: 8, end: 2 },
        { start: Number.NaN, end: Number.NaN },
      ]) {
        const safe = clampRange(range, duration);
        expect(() =>
          planFrames({ duration: 1, width: 100, height: 100 }, safe, 12, "None"),
        ).not.toThrow();
      }
    }
  });
});
