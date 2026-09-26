import { describe, expect, it } from "vitest";
import { frameOperations } from "./operations";

const clip = { width: 1920, height: 1080 };
const frame = { width: 640, height: 360 };

describe("video frame operations", () => {
  it("scales a source-space crop down to the working frame", () => {
    expect(
      frameOperations({ crop: { x: 480, y: 270, width: 960, height: 540 } }, clip, frame),
    ).toEqual({ crop: { x: 160, y: 90, width: 320, height: 180 } });
  });

  it("keeps colour operations unscaled", () => {
    const ops = frameOperations({ invert: true, hue: 30, rotate: 90 }, clip, frame);
    expect(ops).toEqual({ rotate: 90, hue: 30, invert: true });
  });

  it("drops identity operations", () => {
    expect(frameOperations({}, clip, frame)).toBeUndefined();
    expect(frameOperations({ brightness: 0, flipVertical: false }, clip, frame)).toBeUndefined();
  });

  it("clamps a crop that overflows the working frame", () => {
    expect(
      frameOperations({ crop: { x: 0, y: 0, width: 1920, height: 1080 } }, clip, frame),
    ).toEqual({ crop: { x: 0, y: 0, width: 640, height: 360 } });
    // 200 tall becomes 67 at a third of the size, then clamps to 360 - 333.
    expect(
      frameOperations({ crop: { x: 1800, y: 1000, width: 200, height: 200 } }, clip, frame),
    ).toEqual({ crop: { x: 600, y: 333, width: 40, height: 27 } });
  });

  it("leaves the crop alone when the frame matches the source", () => {
    const crop = { x: 10, y: 20, width: 30, height: 40 };
    expect(frameOperations({ crop }, clip, clip)).toEqual({ crop });
  });

  it("survives an unknown source size", () => {
    expect(
      frameOperations(
        { crop: { x: 0, y: 0, width: 8, height: 8 } },
        { width: 0, height: 0 },
        frame,
      ),
    ).toEqual({ crop: { x: 0, y: 0, width: 8, height: 8 } });
  });
});
