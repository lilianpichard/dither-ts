import { beforeEach, describe, expect, it, vi } from "vitest";

const encoderState = vi.hoisted(() => ({
  chunkBytes: 0,
  encoders: [] as Array<{
    configure: ReturnType<typeof vi.fn>;
    encode: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  muxers: [] as Array<{
    addVideoChunk: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
  }>,
  videoFrames: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
}));

vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class {
    buffer: ArrayBuffer | null = null;
  },
  Muxer: class {
    target = { buffer: null as ArrayBuffer | null };
    addVideoChunk = vi.fn();
    finalize = vi.fn(() => {
      this.target.buffer = new ArrayBuffer(8);
    });
    constructor() {
      encoderState.muxers.push(this);
    }
  },
}));

import { exportMp4 } from "./exportMp4";

class FakeVideoEncoder {
  encodeQueueSize = 0;
  configure = vi.fn();
  output: (chunk: { byteLength: number }) => void;
  encode = vi.fn(() => {
    this.encodeQueueSize = 0;
    if (encoderState.chunkBytes > 0) this.output({ byteLength: encoderState.chunkBytes });
  });
  flush = vi.fn(async () => {
    this.encodeQueueSize = 0;
  });
  close = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor({ output }: { output: (chunk: { byteLength: number }) => void }) {
    this.output = output;
    encoderState.encoders.push(this);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeVideoFrame {
  close = vi.fn();
  constructor(
    public data: Uint8ClampedArray,
    public init: unknown,
  ) {
    encoderState.videoFrames.push(this);
  }
}

function frame(): { data: Uint8ClampedArray; width: number; height: number } {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
}

beforeEach(() => {
  encoderState.chunkBytes = 0;
  encoderState.encoders.length = 0;
  encoderState.muxers.length = 0;
  encoderState.videoFrames.length = 0;
});

describe("MP4 async export lifecycle", () => {
  it("closes the encoder when cancellation interrupts the next frame", async () => {
    const controller = new AbortController();
    vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder });
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    const source = (async function* () {
      yield frame();
      await new Promise(() => {});
    })();
    const pending = exportMp4(source, 10, undefined, { signal: controller.signal, total: 2 });
    await vi.waitFor(() => expect(encoderState.encoders.at(-1)?.encode).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(encoderState.encoders.at(-1)?.close).toHaveBeenCalledTimes(1);
  });

  it("flushes and finalizes an async frame sequence", async () => {
    vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder });
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    const source = (async function* () {
      yield frame();
      yield frame();
    })();
    const blob = await exportMp4(source, 10, undefined, { total: 2 });
    expect(blob.type).toBe("video/mp4");
    expect(encoderState.encoders.at(-1)?.flush).toHaveBeenCalledTimes(1);
    expect(encoderState.muxers.at(-1)?.finalize).toHaveBeenCalledTimes(1);
    expect(encoderState.videoFrames.every((value) => value.close.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("aborts the upstream controller without waiting for a hanging iterator after a byte-cap failure", async () => {
    vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder });
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    encoderState.chunkBytes = 8;
    const controller = new AbortController();
    const returnPromise = new Promise<IteratorResult<ReturnType<typeof frame>>>(() => {});
    const iterator: AsyncIterator<ReturnType<typeof frame>> = {
      next: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: frame() })
        .mockReturnValueOnce(new Promise<IteratorResult<ReturnType<typeof frame>>>(() => {})),
      return: vi.fn(() => returnPromise),
    };
    const source = { [Symbol.asyncIterator]: () => iterator };
    const pending = exportMp4(source, 10, undefined, {
      maxBytes: 4,
      signal: controller.signal,
      controller,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("export cleanup timed out")), 100);
          }),
        ]),
      ).rejects.toThrow(/byte cap/i);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    expect(controller.signal.aborted).toBe(true);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it("fails at the configured byte cap and closes the encoder", async () => {
    vi.stubGlobal("window", { VideoEncoder: FakeVideoEncoder });
    vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
    vi.stubGlobal("VideoFrame", FakeVideoFrame);
    await expect(exportMp4([frame()], 10, undefined, { maxBytes: 4 })).rejects.toThrow(/byte cap/i);
    expect(encoderState.encoders.at(-1)?.close).toHaveBeenCalledTimes(1);
    expect(encoderState.muxers.at(-1)?.finalize).toHaveBeenCalledTimes(1);
  });
});
