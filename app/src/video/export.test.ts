import { describe, expect, it, vi } from "vitest";
import type { RGB } from "../../../src/index.js";
import { resolveExportPalette } from "./exportGif";
import { closeExportIterator, validateExportFrame, waitForEncoderCapacity } from "./exportMp4";

class FakeEncoder {
  encodeQueueSize = 1;
  flushCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  async flush(): Promise<void> {
    this.flushCalls++;
    this.encodeQueueSize = 0;
  }
}

function encoder(value: FakeEncoder): VideoEncoder {
  return value as unknown as VideoEncoder;
}

describe("video export frame validation", () => {
  it("rejects malformed frames before encoder input", () => {
    expect(() =>
      validateExportFrame({ data: new Uint8ClampedArray(3), width: 1, height: 1 }),
    ).toThrow(/data/i);
    expect(() =>
      validateExportFrame({ data: new Uint8ClampedArray(4), width: 0, height: 1 }),
    ).toThrow(/dimensions/i);
    expect(() =>
      validateExportFrame({ data: new Uint8ClampedArray(4), width: 1.5, height: 1 }),
    ).toThrow(/dimensions/i);
    expect(() =>
      validateExportFrame({ data: undefined as unknown as Uint8ClampedArray, width: 1, height: 1 }),
    ).toThrow(/data/i);
  });
});

describe("export iterator cleanup", () => {
  it("awaits return during successful cleanup", async () => {
    let resolveReturn!: (value: IteratorResult<never>) => void;
    const returned = new Promise<IteratorResult<never>>((resolve) => {
      resolveReturn = resolve;
    });
    const iterator = {
      return: vi.fn(() => returned),
    } as unknown as AsyncIterator<never>;
    let settled = false;
    const pending = closeExportIterator(iterator, undefined, false).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    resolveReturn({ done: true, value: undefined as never });
    await pending;
    expect(settled).toBe(true);
  });
});

describe("WebCodecs backpressure", () => {
  it("waits for a dequeue event when the encoder queue is full", async () => {
    const value = new FakeEncoder();
    const pending = waitForEncoderCapacity(encoder(value));
    expect(value.encodeQueueSize).toBe(1);
    value.encodeQueueSize = 0;
    value.emit("dequeue");
    await expect(pending).resolves.toBeUndefined();
    expect(value.flushCalls).toBe(0);
  });

  it("rejects an invalid encoder queue size", async () => {
    await expect(waitForEncoderCapacity({ encodeQueueSize: Number.NaN })).rejects.toThrow(/queue/i);
  });

  it("falls back to flushing when dequeue events are unavailable", async () => {
    const value = new FakeEncoder();
    const withoutEvents = {
      encodeQueueSize: value.encodeQueueSize,
      flush: () => value.flush(),
    } as unknown as VideoEncoder;
    await waitForEncoderCapacity(withoutEvents);
    expect(value.flushCalls).toBe(1);
  });

  it("races encoder failure when dequeue events and flush are unavailable", async () => {
    let rejectFailure!: (reason: Error) => void;
    const failure = new Promise<never>((_, reject) => {
      rejectFailure = reject;
    });
    const pending = waitForEncoderCapacity({ encodeQueueSize: 1 }, undefined, failure);
    rejectFailure(new Error("encoder failed"));
    await expect(pending).rejects.toThrow("encoder failed");
  });
});

describe("GIF palette selection", () => {
  it("uses black and white for monochrome output", () => {
    expect(resolveExportPalette("GameBoy", true)).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });

  it("falls back to black and white for an unknown name", () => {
    expect(resolveExportPalette("Missing")).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
    expect(resolveExportPalette("GameBoy")).not.toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });

  it("does not resolve an inherited key as a palette", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(resolveExportPalette(name)).toEqual([
        [0, 0, 0],
        [255, 255, 255],
      ]);
    }
  });

  it("keeps a custom list of a usable length", () => {
    const custom: RGB[] = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    expect(resolveExportPalette(custom)).toBe(custom);
    expect(resolveExportPalette([[1, 2, 3]])).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });
});
