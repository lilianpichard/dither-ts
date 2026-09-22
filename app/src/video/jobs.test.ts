import { describe, expect, it } from "vitest";
import { fitSize, isHeavyMethod, isOrderedMethod, planFrames } from "./jobs";

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
      { start: -3, end: 99 },
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
});
