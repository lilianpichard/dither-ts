import { describe, expect, it } from "vitest";
import { META_INSET, fitView, matchesGeometry } from "./canvasFit";

describe("fitView", () => {
  it("scales to the tighter of the two axes so the image always fits", () => {
    // Wide box, image limited by height.
    const wide = fitView(1000, 500, 100, 100);
    expect(wide.scale).toBeCloseTo((500 - META_INSET) / 100);

    // Tall box, image limited by width.
    const tall = fitView(500, 1000, 100, 100);
    expect(tall.scale).toBeCloseTo(500 / 100);
  });

  it("reserves the meta strip when choosing the scale", () => {
    // The strip is reserved in the scale, but the image is then centred in the
    // full box, so it only ever ends up inset/2 clear at the bottom.
    const v = fitView(1000, 500, 100, 100);
    expect(100 * v.scale + META_INSET).toBeLessThanOrEqual(500 + 1e-9);
    expect(v.oy).toBeCloseTo(META_INSET / 2);
  });

  it("centres the image in the box", () => {
    const v = fitView(800, 600, 200, 100);
    expect(v.ox).toBeCloseTo((800 - 200 * v.scale) / 2);
    expect(v.oy).toBeCloseTo((600 - 100 * v.scale) / 2);
  });

  it("leaves a horizontal gutter when height is the binding axis", () => {
    const v = fitView(1000, 300, 200, 200);
    expect(v.ox).toBeGreaterThan(0);
    expect(v.oy).toBeGreaterThanOrEqual(0);
  });

  it("accepts a custom inset", () => {
    expect(fitView(1000, 500, 100, 100, 0).scale).toBeCloseTo(5);
    expect(fitView(1000, 500, 100, 100, 100).scale).toBeCloseTo(4);
  });
});

describe("matchesGeometry", () => {
  it("accepts a bitmap that covers exactly the viewport it is painted into", () => {
    expect(matchesGeometry({ width: 600, height: 800 }, 600, 800)).toBe(true);
  });

  it("refuses a bitmap of a different shape, so a turn is not stretched away", () => {
    // The classic case: an unrotated source against a turned frame. Painting it
    // would rescale the pixels into the wrong aspect and move nothing else.
    expect(matchesGeometry({ width: 800, height: 600 }, 600, 800)).toBe(false);
    expect(matchesGeometry({ width: 800, height: 600 }, 800, 600)).toBe(true);
  });

  it("refuses a missing bitmap or an unmeasured viewport", () => {
    expect(matchesGeometry(null, 600, 800)).toBe(false);
    expect(matchesGeometry({ width: 600, height: 800 }, 0, 0)).toBe(false);
  });
});
