import { describe, expect, it } from "vitest";
import { frameFromImageData, sameFrame, type FramePixels } from "./frame";

function imageData(width: number, height: number, fill = 7): FramePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 1] = fill + 1;
    data[i + 2] = fill + 2;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

describe("frameFromImageData", () => {
  it("carries the dimensions across", () => {
    const frame = frameFromImageData(imageData(6, 3));
    expect(frame.width).toBe(6);
    expect(frame.height).toBe(3);
  });

  it("copies the pixels rather than aliasing them", () => {
    const source = imageData(2, 2, 10);
    const frame = frameFromImageData(source);
    // Writing through the original must not change the captured frame.
    source.data[0] = 200;
    expect(new Uint8ClampedArray(frame.pixels)[0]).toBe(10);
  });

  it("preserves the RGBA bytes", () => {
    const frame = frameFromImageData(imageData(2, 1, 40));
    expect([...new Uint8ClampedArray(frame.pixels)]).toEqual([40, 41, 42, 255, 40, 41, 42, 255]);
  });
});

describe("sameFrame", () => {
  const a = { width: 2, height: 2, pixels: new ArrayBuffer(16) };

  it("treats identity as equal", () => {
    expect(sameFrame(a, a)).toBe(true);
  });

  it("detects a different buffer", () => {
    expect(sameFrame(a, { ...a, pixels: new ArrayBuffer(16) })).toBe(false);
  });

  it("detects a different size", () => {
    expect(sameFrame(a, { ...a, width: 3 })).toBe(false);
    expect(sameFrame(a, { ...a, height: 3 })).toBe(false);
  });

  it("handles null on either side", () => {
    expect(sameFrame(null, null)).toBe(true);
    expect(sameFrame(null, a)).toBe(false);
    expect(sameFrame(a, null)).toBe(false);
  });
});
