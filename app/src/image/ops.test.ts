import { describe, expect, it } from "vitest";
import type { RGBAImage } from "../../../src/index.js";
import type { ImageOperations, QuarterTurn } from "./ops";
import {
  adjustBrightness,
  adjustContrast,
  adjustSaturation,
  applyOperations,
  crop,
  flipHorizontal,
  flipVertical,
  invert,
  rotate,
  rotateHue,
} from "./ops";

function makeImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = pixel(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

function ramp(width: number, height: number): RGBAImage {
  return makeImage(width, height, (x, y) => [x * 10, y * 10, (x + y) * 5, 255]);
}

/** Each pixel encodes its own origin coordinate: r = x, g = y. */
function grid(width: number, height: number): RGBAImage {
  return makeImage(width, height, (x, y) => [x, y, 0, 255]);
}

function pixels(image: RGBAImage): string {
  const parts: string[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      parts.push(
        `${x},${y}=${image.data[i]},${image.data[i + 1]},${image.data[i + 2]},${image.data[i + 3]}`,
      );
    }
  }
  return parts.join(" ");
}

describe("crop", () => {
  it("extracts a rectangle and shrinks the dimensions", () => {
    const source = ramp(4, 3);
    const out = crop(source, { x: 1, y: 1, width: 2, height: 2 });
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data).toBeInstanceOf(Uint8ClampedArray);
    expect(pixels(out)).toBe("0,0=10,10,10,255 1,0=20,10,15,255 0,1=10,20,15,255 1,1=20,20,20,255");
  });

  it("preserves alpha including fully transparent pixels", () => {
    const source = makeImage(3, 1, (x) => [10 * x, 0, 0, x === 1 ? 0 : 128]);
    expect(pixels(crop(source, { x: 0, y: 0, width: 3, height: 1 }))).toBe(
      "0,0=0,0,0,128 1,0=10,0,0,0 2,0=20,0,0,128",
    );
  });

  it("does not mutate the source buffer", () => {
    const source = ramp(4, 3);
    const before = pixels(source);
    const out = crop(source, { x: 2, y: 1, width: 2, height: 2 });
    out.data[0] = 250;
    expect(pixels(source)).toBe(before);
    expect(source.data).not.toBe(out.data);
  });
});

describe("rotate", () => {
  it("turns 90 clockwise and swaps the dimensions", () => {
    const out = rotate(grid(3, 2), 90);
    expect(`${out.width}x${out.height}`).toBe("2x3");
    expect(pixels(out)).toBe(
      "0,0=0,1,0,255 1,0=0,0,0,255 0,1=1,1,0,255 1,1=1,0,0,255 0,2=2,1,0,255 1,2=2,0,0,255",
    );
  });

  it("turns 180 and keeps the dimensions", () => {
    const out = rotate(grid(3, 2), 180);
    expect(`${out.width}x${out.height}`).toBe("3x2");
    expect(pixels(out)).toBe(
      "0,0=2,1,0,255 1,0=1,1,0,255 2,0=0,1,0,255 0,1=2,0,0,255 1,1=1,0,0,255 2,1=0,0,0,255",
    );
  });

  it("turns 270 clockwise and swaps the dimensions", () => {
    const out = rotate(grid(3, 2), 270);
    expect(`${out.width}x${out.height}`).toBe("2x3");
    expect(pixels(out)).toBe(
      "0,0=2,0,0,255 1,0=2,1,0,255 0,1=1,0,0,255 1,1=1,1,0,255 0,2=0,0,0,255 1,2=0,1,0,255",
    );
  });

  it("leaves the image alone for a zero turn", () => {
    const source = grid(3, 2);
    const out = rotate(source, 0);
    expect(pixels(out)).toBe(pixels(source));
    expect(out.data).not.toBe(source.data);
  });

  it("does not mutate the source buffer", () => {
    const source = grid(3, 2);
    const before = pixels(source);
    rotate(source, 90).data[0] = 250;
    expect(pixels(source)).toBe(before);
  });

  it("rejects turns that are not quarter turns", () => {
    expect(() => rotate(grid(2, 2), 45 as QuarterTurn)).toThrow(TypeError);
    expect(() => rotate(grid(2, 2), -90 as QuarterTurn)).toThrow(TypeError);
    expect(() => rotate(grid(2, 2), 360 as QuarterTurn)).toThrow(TypeError);
  });
});

describe("flips", () => {
  it("mirrors rows for a horizontal flip", () => {
    const out = flipHorizontal(grid(3, 2));
    expect(`${out.width}x${out.height}`).toBe("3x2");
    expect(pixels(out)).toBe(
      "0,0=2,0,0,255 1,0=1,0,0,255 2,0=0,0,0,255 0,1=2,1,0,255 1,1=1,1,0,255 2,1=0,1,0,255",
    );
  });

  it("mirrors columns for a vertical flip", () => {
    const out = flipVertical(grid(3, 2));
    expect(`${out.width}x${out.height}`).toBe("3x2");
    expect(pixels(out)).toBe(
      "0,0=0,1,0,255 1,0=1,1,0,255 2,0=2,1,0,255 0,1=0,0,0,255 1,1=1,0,0,255 2,1=2,0,0,255",
    );
  });

  it("keeps alpha attached to its pixel", () => {
    const source = makeImage(2, 1, (x) => [10, 20, 30, x === 0 ? 7 : 0]);
    expect(pixels(flipHorizontal(source))).toBe("0,0=10,20,30,0 1,0=10,20,30,7");
  });

  it("does not mutate the source buffer", () => {
    const source = grid(3, 2);
    const before = pixels(source);
    flipHorizontal(source).data[0] = 250;
    flipVertical(source).data[0] = 250;
    expect(pixels(source)).toBe(before);
  });
});

describe("brightness", () => {
  it("shifts every channel by a share of the full range and keeps alpha", () => {
    const source = makeImage(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [10, 0, 5, 128]));
    // The half transparent pixel is lifted by the same 102 in premultiplied space.
    expect(pixels(adjustBrightness(source, 0.4))).toBe("0,0=102,102,102,255 1,0=213,203,209,128");
  });

  it("collapses to black at the minimum", () => {
    const source = makeImage(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [10, 0, 5, 255]));
    expect(pixels(adjustBrightness(source, -1))).toBe("0,0=0,0,0,255 1,0=0,0,0,255");
  });

  it("collapses to white at the maximum", () => {
    const source = makeImage(1, 1, () => [200, 100, 50, 255]);
    expect(pixels(adjustBrightness(source, 1))).toBe("0,0=255,255,255,255");
  });

  it("is a no-op at zero", () => {
    const source = ramp(2, 2);
    const out = adjustBrightness(source, 0);
    expect(pixels(out)).toBe(pixels(source));
    expect(out.data).not.toBe(source.data);
  });

  it("leaves a fully transparent pixel invisible and unchanged", () => {
    const source = makeImage(1, 1, () => [10, 20, 30, 0]);
    expect(pixels(adjustBrightness(source, 0.5))).toBe("0,0=10,20,30,0");
  });

  it("does not mutate the source buffer", () => {
    const source = ramp(2, 2);
    const before = pixels(source);
    adjustBrightness(source, 0.5).data[0] = 250;
    expect(pixels(source)).toBe(before);
  });

  it("rejects amounts outside the unit interval", () => {
    const source = ramp(1, 1);
    expect(() => adjustBrightness(source, 1.5)).toThrow(TypeError);
    expect(() => adjustBrightness(source, -1.5)).toThrow(TypeError);
    expect(() => adjustBrightness(source, Number.NaN)).toThrow(TypeError);
    expect(() => adjustBrightness(source, Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => adjustBrightness(source, "0.5" as unknown as number)).toThrow(TypeError);
  });
});

describe("contrast", () => {
  it("pushes channels away from mid grey", () => {
    const source = makeImage(2, 1, (x) => (x === 0 ? [100, 100, 100, 255] : [200, 200, 200, 255]));
    expect(pixels(adjustContrast(source, 1))).toBe("0,0=72,72,72,255 1,0=255,255,255,255");
  });

  it("pulls channels toward mid grey when negative", () => {
    const source = makeImage(1, 1, () => [200, 0, 100, 255]);
    expect(pixels(adjustContrast(source, -0.5))).toBe("0,0=164,64,114,255");
  });

  it("keeps mid grey and pure black fixed", () => {
    const source = makeImage(2, 1, (x) => (x === 0 ? [128, 128, 128, 255] : [0, 0, 0, 255]));
    expect(pixels(adjustContrast(source, 1))).toBe("0,0=128,128,128,255 1,0=0,0,0,255");
  });

  it("flattens a translucent pixel to the same grey it composites to when opaque", () => {
    const opaque = adjustContrast(
      makeImage(1, 1, () => [255, 0, 0, 255]),
      -1,
    );
    const half = adjustContrast(
      makeImage(1, 1, () => [255, 0, 0, 128]),
      -1,
    );
    expect(pixels(opaque)).toBe("0,0=128,128,128,255");
    expect((half.data[0] * 128) / 255).toBeCloseTo(opaque.data[0], 0);
    expect(half.data[3]).toBe(128);
  });

  it("rejects amounts outside the unit interval", () => {
    const source = ramp(1, 1);
    expect(() => adjustContrast(source, 1.01)).toThrow(TypeError);
    expect(() => adjustContrast(source, Number.NaN)).toThrow(TypeError);
  });
});

describe("saturation", () => {
  it("removes all colour at the minimum", () => {
    const source = makeImage(1, 1, () => [200, 100, 50, 255]);
    expect(pixels(adjustSaturation(source, -1))).toBe("0,0=124,124,124,255");
  });

  it("keeps a grey pixel grey", () => {
    const source = makeImage(1, 1, () => [90, 90, 90, 255]);
    expect(pixels(adjustSaturation(source, 0.8))).toBe("0,0=90,90,90,255");
  });

  it("widens the channel spread when positive", () => {
    const source = makeImage(1, 1, () => [100, 128, 156, 255]);
    const out = adjustSaturation(source, 1);
    expect(out.data[0]).toBeLessThan(100);
    expect(out.data[2]).toBeGreaterThan(156);
  });

  it("desaturates in premultiplied space so alpha is preserved", () => {
    const source = makeImage(1, 1, () => [255, 0, 0, 128]);
    expect(pixels(adjustSaturation(source, -1))).toBe("0,0=76,76,76,128");
  });

  it("does not mutate the source buffer", () => {
    const source = makeImage(1, 1, () => [200, 100, 50, 255]);
    adjustSaturation(source, 0.5).data[0] = 250;
    expect(pixels(source)).toBe("0,0=200,100,50,255");
  });

  it("rejects amounts outside the unit interval", () => {
    const source = ramp(1, 1);
    expect(() => adjustSaturation(source, -2)).toThrow(TypeError);
    expect(() => adjustSaturation(source, Number.NaN)).toThrow(TypeError);
  });
});

describe("hue rotation", () => {
  it("maps red to green at 120 degrees", () => {
    const source = makeImage(1, 1, () => [255, 0, 0, 255]);
    expect(pixels(rotateHue(source, 120))).toBe("0,0=0,255,0,255");
  });

  it("maps red to blue at -120 degrees", () => {
    const source = makeImage(1, 1, () => [255, 0, 0, 255]);
    expect(pixels(rotateHue(source, -120))).toBe("0,0=0,0,255,255");
  });

  it("is a no-op for a zero rotation and inverts the hue for a half turn", () => {
    const source = makeImage(1, 1, () => [12, 200, 90, 255]);
    expect(pixels(rotateHue(source, 0))).toBe("0,0=12,200,90,255");
    expect(pixels(rotateHue(source, 180))).toBe("0,0=200,12,122,255");
  });

  it("round trips within a rounding step", () => {
    const source = makeImage(1, 1, () => [200, 120, 40, 255]);
    const there = rotateHue(source, 90);
    const back = rotateHue(there, -90);
    for (let c = 0; c < 3; c++)
      expect(Math.abs(back.data[c] - source.data[c])).toBeLessThanOrEqual(1);
  });

  it("leaves a fully transparent pixel unchanged", () => {
    const source = makeImage(1, 1, () => [10, 20, 30, 0]);
    expect(pixels(rotateHue(source, 90))).toBe("0,0=10,20,30,0");
  });

  it("rotates a half transparent pixel in premultiplied space", () => {
    const source = makeImage(1, 1, () => [255, 0, 0, 128]);
    expect(pixels(rotateHue(source, 120))).toBe("0,0=0,255,0,128");
  });

  it("rejects angles outside a half turn", () => {
    const source = ramp(1, 1);
    expect(() => rotateHue(source, 181)).toThrow(TypeError);
    expect(() => rotateHue(source, -181)).toThrow(TypeError);
    expect(() => rotateHue(source, 360)).toThrow(TypeError);
    expect(() => rotateHue(source, Number.NaN)).toThrow(TypeError);
  });
});

describe("invert", () => {
  it("flips the channels and keeps alpha", () => {
    const source = makeImage(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [10, 20, 30, 255]));
    expect(pixels(invert(source))).toBe("0,0=255,255,255,255 1,0=245,235,225,255");
  });

  it("inverts what a translucent pixel composites to", () => {
    const source = makeImage(1, 1, () => [10, 20, 30, 128]);
    const out = invert(source);
    // The premultiplied colour 5,10,15 becomes 250,245,240, which no longer
    // fits an 8 bit straight channel at alpha 128, so it clamps to white.
    expect(pixels(out)).toBe("0,0=255,255,255,128");
    expect((out.data[0] * 128) / 255).toBeGreaterThan((source.data[0] * 128) / 255);
  });

  it("leaves a fully transparent pixel unchanged", () => {
    const source = makeImage(1, 1, () => [10, 20, 30, 0]);
    expect(pixels(invert(source))).toBe("0,0=10,20,30,0");
  });

  it("is its own inverse", () => {
    const source = makeImage(1, 1, () => [12, 200, 90, 255]);
    expect(pixels(invert(invert(source)))).toBe("0,0=12,200,90,255");
  });

  it("does not mutate the source buffer", () => {
    const source = makeImage(1, 1, () => [12, 200, 90, 77]);
    invert(source).data[0] = 250;
    expect(pixels(source)).toBe("0,0=12,200,90,77");
  });
});

describe("applyOperations", () => {
  it("returns an unchanged copy for an empty operations object", () => {
    const source = ramp(3, 2);
    const out = applyOperations(source, {});
    expect(`${out.width}x${out.height}`).toBe("3x2");
    expect(pixels(out)).toBe(pixels(source));
    expect(out.data).not.toBe(source.data);
  });

  it("treats all zero adjustments as identity", () => {
    const source = ramp(3, 2);
    const out = applyOperations(source, {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hue: 0,
      invert: false,
      flipHorizontal: false,
      flipVertical: false,
    });
    expect(pixels(out)).toBe(pixels(source));
  });

  it("crops in source coordinates before rotating", () => {
    const source = grid(4, 4);
    const out = applyOperations(source, { crop: { x: 2, y: 0, width: 2, height: 2 }, rotate: 90 });
    expect(`${out.width}x${out.height}`).toBe("2x2");
    expect(pixels(out)).toBe("0,0=2,1,0,255 1,0=2,0,0,255 0,1=3,1,0,255 1,1=3,0,0,255");
  });

  it("matches composing the individual operations by hand", () => {
    const source = makeImage(2, 2, (x, y) =>
      x === 0 && y === 0 ? [10, 200, 30, 255] : [90, 90, 90, 255],
    );
    const expected = invert(adjustBrightness(flipVertical(source), 0.2));
    expect(
      pixels(applyOperations(source, { flipVertical: true, brightness: 0.2, invert: true })),
    ).toBe(pixels(expected));
  });

  it("is deterministic across runs", () => {
    const source = ramp(4, 3);
    const ops: ImageOperations = {
      crop: { x: 1, y: 1, width: 2, height: 2 },
      rotate: 270,
      saturation: 0.5,
      hue: 30,
    };
    expect(pixels(applyOperations(source, ops))).toBe(pixels(applyOperations(source, ops)));
  });

  it("does not mutate the source buffer", () => {
    const source = ramp(3, 2);
    const before = pixels(source);
    applyOperations(source, { crop: { x: 0, y: 0, width: 2, height: 2 }, invert: true });
    expect(pixels(source)).toBe(before);
  });

  it("rejects a non-object operations value", () => {
    const source = ramp(1, 1);
    expect(() => applyOperations(source, null as unknown as ImageOperations)).toThrow(TypeError);
    expect(() => applyOperations(source, [] as unknown as ImageOperations)).toThrow(TypeError);
  });

  it("rejects unknown or malformed fields", () => {
    const source = ramp(4, 4);
    expect(() => applyOperations(source, { brightness: 2 })).toThrow(TypeError);
    expect(() => applyOperations(source, { hue: 200 })).toThrow(TypeError);
    expect(() => applyOperations(source, { rotate: 45 } as unknown as ImageOperations)).toThrow(
      TypeError,
    );
    expect(() => applyOperations(source, { crop: { x: 0, y: 0, width: 9, height: 1 } })).toThrow(
      TypeError,
    );
    expect(() => applyOperations(source, { invert: "yes" } as unknown as ImageOperations)).toThrow(
      TypeError,
    );
  });
});
