import { describe, expect, it, vi } from "vitest";

// gifenc's real quantizer is what fixes the bug, so it is not mocked here; only
// the encoder is, so the palette handed to writeFrame can be inspected.
const gifState = vi.hoisted(() => ({
  instances: [] as Array<{
    writeFrame: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    bytes: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("gifenc", async () => {
  // The real quantizer is what the fix relies on, so only the encoder is faked.
  const actual = await vi.importActual<typeof import("gifenc")>("gifenc");
  return {
    ...actual,
    GIFEncoder: vi.fn(() => {
      const instance = {
        writeFrame: vi.fn(),
        finish: vi.fn(),
        bytes: vi.fn(() => new Uint8Array(4)),
      };
      gifState.instances.push(instance);
      return instance;
    }),
  };
});

import { exportGif } from "./exportGif";

/** A frame with far more colours than a GIF can hold, like a real photo. */
function photoFrame(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = ((x + y) * 255) / (width + height);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("GIF colour for original colour mode", () => {
  it("keeps the frame's colours when it has too many for a gif", async () => {
    const source = (async function* () {
      yield photoFrame(96, 96);
      yield photoFrame(96, 96);
    })();
    // The palette a legacy preset resolves to when the name it carries does
    // not exist in the kernel: two colours, for a frame that is full of them.
    await exportGif(source, 12, "B&W", undefined, {
      total: 2,
      monochrome: false,
    });
    const palette = gifState.instances.at(-1)!.writeFrame.mock.calls[0][3].palette;
    // More than the two colours it used to fall back to, which turned a colour
    // preview into a black and white gif.
    expect(palette.length).toBeGreaterThan(2);
    expect(palette.length).toBeLessThanOrEqual(256);
  });

  it("quantises rather than truncating when a palette-mode frame is blended", async () => {
    // Blur and glow mix the palette's entries, so even a palette-mode frame can
    // outgrow a GIF table.
    const source = (async function* () {
      yield photoFrame(96, 96);
    })();
    await exportGif(source, 12, "Gruvbox", undefined, {
      total: 1,
      monochrome: false,
    });
    const palette = gifState.instances.at(-1)!.writeFrame.mock.calls[0][3].palette;
    expect(palette.length).toBeGreaterThan(2);
  });

  it("still writes black and white when the output is monochrome", async () => {
    const source = (async function* () {
      yield photoFrame(96, 96);
    })();
    await exportGif(source, 12, "Gruvbox", undefined, {
      total: 1,
      monochrome: true,
    });
    const palette = gifState.instances.at(-1)!.writeFrame.mock.calls[0][3].palette;
    expect(palette).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });
});
