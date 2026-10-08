import { describe, expect, it, vi } from "vitest";

const gifState = vi.hoisted(() => ({
  instances: [] as Array<{
    writeFrame: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    bytes: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    finished: boolean;
  }>,
}));

// The real quantizer is needed for frames that outgrow a gif table; only the
// encoder is faked, so the palette handed to writeFrame can be inspected.
vi.mock("gifenc", async () => {
  const actual = await vi.importActual<typeof import("gifenc")>("gifenc");
  return {
    ...actual,
    GIFEncoder: vi.fn(() => {
      const instance = {
        writeFrame: vi.fn(),
        finish: vi.fn(() => {
          instance.finished = true;
        }),
        bytes: vi.fn(() => new Uint8Array(instance.finished ? 4 : 3)),
        reset: vi.fn(),
        finished: false,
      };
      gifState.instances.push(instance);
      return instance;
    }),
  };
});

import { exportGif } from "./exportGif";

function frame(): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };
}

describe("GIF async frame consumption", () => {
  it("passes a black-and-white palette for monochrome output", async () => {
    const source = (async function* () {
      yield frame();
    })();
    await exportGif(source, 10, "GameBoy", undefined, { total: 1, color: false });
    const encoder = gifState.instances.at(-1)!;
    expect(encoder.writeFrame.mock.calls[0][3].palette).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });

  it("does not finish after cancellation while requesting the next frame", async () => {
    const controller = new AbortController();
    const source = (async function* () {
      yield frame();
      controller.abort();
    })();
    await expect(
      exportGif(source, 10, "B&W", undefined, { signal: controller.signal, total: 1 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const encoder = gifState.instances.at(-1)!;
    expect(encoder.finish).not.toHaveBeenCalled();
    expect(encoder.reset).toHaveBeenCalledTimes(1);
  });

  it("fails at the configured byte cap before finishing", async () => {
    await expect(exportGif([frame()], 10, "B&W", undefined, { maxBytes: 2 })).rejects.toThrow(
      /byte cap/i,
    );
    const encoder = gifState.instances.at(-1)!;
    expect(encoder.finish).not.toHaveBeenCalled();
    expect(encoder.reset).toHaveBeenCalledTimes(1);
  });

  it("aborts the upstream controller without waiting for a hanging iterator", async () => {
    const controller = new AbortController();
    const returnPromise = new Promise<IteratorResult<ReturnType<typeof frame>>>(() => {});
    const iterator: AsyncIterator<ReturnType<typeof frame>> = {
      next: vi.fn().mockResolvedValue({ done: false, value: frame() }),
      return: vi.fn(() => returnPromise),
    };
    const source = { [Symbol.asyncIterator]: () => iterator };
    await expect(
      exportGif(source, 10, "B&W", undefined, {
        maxBytes: 2,
        signal: controller.signal,
        controller,
      }),
    ).rejects.toThrow(/byte cap/i);
    expect(controller.signal.aborted).toBe(true);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it("fails when the GIF trailer crosses the configured cap", async () => {
    await expect(exportGif([frame()], 10, "B&W", undefined, { maxBytes: 3 })).rejects.toThrow(
      /byte cap/i,
    );
    const encoder = gifState.instances.at(-1)!;
    expect(encoder.finish).toHaveBeenCalledTimes(1);
    expect(encoder.reset).toHaveBeenCalledTimes(1);
  });
});
