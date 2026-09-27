import { describe, expect, it } from "vitest";
import { runRender } from "./render";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  const width = overrides.width ?? 4;
  const height = overrides.height ?? 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 256;
    data[i + 1] = 128;
    data[i + 2] = 200;
    data[i + 3] = 255;
  }
  return {
    id: 7,
    width,
    height,
    pixels: data.buffer as ArrayBuffer,
    color: false,
    colorMode: "palette",
    method: "None",
    threshold: 128,
    palette: "B&W",
    pixelSize: 1,
    effects: [],
    seed: 0,
    ...overrides,
  };
}

function collect(req: RenderRequest): RenderResponse {
  const messages: RenderMessage[] = [];
  runRender(req, (message) => messages.push(message));
  const last = messages[messages.length - 1];
  if (!last || last.kind !== "result") throw new Error("no result message");
  return last;
}

function renderPixels(response: RenderResponse): Uint8ClampedArray {
  return new Uint8ClampedArray(response.pixels);
}

describe("render request operations", () => {
  it("dithers the source unchanged when no operations are given", () => {
    const req = request();
    const response = collect(req);
    expect(`${response.width}x${response.height}`).toBe("4x2");
    expect(Array.from(renderPixels(response))).toEqual(
      Array.from(new Uint8ClampedArray(req.pixels)),
    );
  });

  it("keeps the source alpha after identity operations", () => {
    const req = request();
    req.pixels = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128]).buffer as ArrayBuffer;
    req.width = 2;
    req.height = 1;
    const out = renderPixels(collect(req));
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(128);
  });

  it("returns the transformed dimensions for a crop", () => {
    const response = collect(
      request({ operations: { crop: { x: 1, y: 0, width: 2, height: 1 } } }),
    );
    expect(`${response.width}x${response.height}`).toBe("2x1");
  });

  it("swaps the dimensions for a quarter turn", () => {
    const response = collect(request({ operations: { rotate: 90 } }));
    expect(`${response.width}x${response.height}`).toBe("2x4");
  });

  it("dithers the cropped region rather than the whole frame", () => {
    const req = request({ operations: { crop: { x: 2, y: 1, width: 2, height: 1 } } });
    const out = renderPixels(collect(req));
    const source = new Uint8ClampedArray(req.pixels);
    // Row 1 of a 4 wide frame starts at byte 16, so the crop is bytes 24..32.
    expect(Array.from(out)).toEqual(Array.from(source.subarray(24, 32)));
  });

  it("brightens before dithering", () => {
    const identity = renderPixels(collect(request({ color: true })));
    const bright = renderPixels(collect(request({ color: true, operations: { brightness: 1 } })));
    expect(bright[1]).toBeGreaterThan(identity[1]);
    expect(bright[0]).toBeGreaterThan(identity[0]);
  });

  it("preserves the source alpha through an adjustment", () => {
    const req = request({ color: true, operations: { brightness: 0.5 } });
    req.width = 2;
    req.height = 1;
    req.pixels = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128]).buffer as ArrayBuffer;
    const out = renderPixels(collect(req));
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(128);
  });

  it("applies geometry before colour", () => {
    const req = request({ operations: { rotate: 90, invert: true } });
    const out = renderPixels(collect(req));
    const source = new Uint8ClampedArray(req.pixels);
    // Source pixel (3,1) lands at (0,3) of the rotated frame and is inverted.
    expect(out[(3 * 2 + 0) * 4]).toBe(255 - source[(1 * 4 + 3) * 4]);
  });

  it("reports invalid operations instead of rendering", () => {
    expect(() => collect(request({ operations: { rotate: 33 } as never }))).toThrow(TypeError);
    expect(() =>
      collect(request({ operations: { crop: { x: 0, y: 0, width: 99, height: 1 } } })),
    ).toThrow(TypeError);
  });

  it("keeps progress frames at the transformed size", () => {
    const messages: RenderMessage[] = [];
    runRender(
      request({ operations: { crop: { x: 0, y: 0, width: 2, height: 2 } }, progressEvery: 1 }),
      (message) => messages.push(message),
    );
    const progress = messages.find((message) => message.kind === "progress");
    expect(progress).toBeDefined();
    expect(progress && progress.kind === "progress" && `${progress.width}x${progress.height}`).toBe(
      "2x2",
    );
  });
});
