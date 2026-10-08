import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export interface ExportFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ExportFrameSource = AsyncIterable<ExportFrame> | Iterable<ExportFrame>;

export const DEFAULT_EXPORT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Bits per pixel per frame, and the bounds around it.
 *
 * A dither is high-frequency detail by definition, and a rate controller spends
 * its budget on the large flat areas first, so the dots are the first thing to go.
 * At 0.12 the dots turned to smears: a 1080p dither came back visibly blurred even
 * though the frames handed to the encoder were full resolution. Half a bit per
 * pixel keeps them. The floor keeps a small clip off an absurdly low ceiling, and
 * the cap stops a 4K export from producing a file nobody wants.
 */
const BITS_PER_PIXEL = 0.5;
const MIN_BITRATE = 8_000_000;
const MAX_BITRATE = 80_000_000;

export function targetBitrate(width: number, height: number, fps: number): number {
  const raw = width * height * fps * BITS_PER_PIXEL;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

/**
 * H.264 level for a frame size, as an `avc1.6400XX` string.
 *
 * The level caps resolution and rate, and it was pinned at 4.0, which cannot carry
 * 4K. Since the export now defaults to full resolution, a 4K clip would ask the
 * encoder for a stream its own configuration forbids.
 */
export function avcCodecString(width: number, height: number): string {
  const pixels = width * height;
  const level = pixels <= 1920 * 1080 ? 0x28 : pixels <= 2560 * 1440 ? 0x32 : 0x33;
  return `avc1.6400${level.toString(16).padStart(2, "0")}`;
}

export interface ExportOptions {
  signal?: AbortSignal;
  controller?: AbortController;
  abort?: () => void;
  total?: number;
  maxBytes?: number;
}

export interface EncoderCapacity {
  readonly encodeQueueSize: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  flush?: () => Promise<unknown>;
}

export function canExportMp4(): boolean {
  return typeof window !== "undefined" && typeof window.VideoEncoder === "function";
}

function abortError(): Error {
  const error = new Error("video export cancelled");
  error.name = "AbortError";
  return error;
}

export function isExportAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortUpstream(options: ExportOptions): void {
  try {
    options.controller?.abort();
    options.abort?.();
  } catch {
    return;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function validateExportFrame(frame: ExportFrame): void {
  if (
    !Number.isFinite(frame.width) ||
    !Number.isFinite(frame.height) ||
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    throw new RangeError("frame dimensions must be finite positive integers");
  }
  if (!frame.data || typeof frame.data.length !== "number") {
    throw new RangeError("frame data must be a typed array");
  }
  const required = frame.width * frame.height * 4;
  if (!Number.isSafeInteger(required) || frame.data.length < required) {
    throw new RangeError("frame data is too small for its dimensions");
  }
}

function totalFrames(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("frame total must be a finite non-negative number");
  }
  return Math.floor(value);
}

export function validateExportByteCap(value: number | undefined): number {
  const cap = value ?? DEFAULT_EXPORT_MAX_BYTES;
  if (!Number.isSafeInteger(cap) || cap < 0) {
    throw new RangeError("export byte cap must be a finite non-negative integer");
  }
  return cap;
}

export function exportByteCapError(cap: number): Error {
  return new Error(`export exceeds the ${cap}-byte cap`);
}

export function asyncFrameIterator(frames: ExportFrameSource): AsyncIterator<ExportFrame> {
  const asyncFrames = frames as AsyncIterable<ExportFrame>;
  if (typeof asyncFrames[Symbol.asyncIterator] === "function") {
    return asyncFrames[Symbol.asyncIterator]();
  }
  const syncFrames = frames as Iterable<ExportFrame>;
  return (async function* () {
    for (const frame of syncFrames) yield frame;
  })();
}

export async function nextExportFrame(
  iterator: AsyncIterator<ExportFrame>,
  signal: AbortSignal | undefined,
  failure?: Promise<unknown>,
): Promise<IteratorResult<ExportFrame>> {
  if (!signal && !failure) return iterator.next();
  if (signal) throwIfAborted(signal);
  return new Promise<IteratorResult<ExportFrame>>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (failure) {
      void failure.then(
        (reason) => finish(() => reject(asError(reason))),
        (reason) => finish(() => reject(asError(reason))),
      );
    }
    iterator.next().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
    if (signal?.aborted) onAbort();
  });
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  failure?: Promise<unknown>,
): Promise<T> {
  if (!signal && !failure) return promise;
  if (signal) throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (failure) {
      void failure.then(
        (reason) => finish(() => reject(asError(reason))),
        (reason) => finish(() => reject(asError(reason))),
      );
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal?.aborted) onAbort();
  });
}

export async function closeExportIterator(
  iterator: AsyncIterator<ExportFrame>,
  signal: AbortSignal | undefined,
  done: boolean,
  failFast = false,
): Promise<void> {
  if (done) return;
  const returned = iterator.return?.();
  if (signal?.aborted || failFast) {
    void returned?.catch(() => {});
    return;
  }
  await returned;
}

export async function waitForEncoderCapacity(
  encoder: EncoderCapacity,
  signal?: AbortSignal,
  failure?: Promise<unknown>,
): Promise<void> {
  if (!Number.isFinite(encoder.encodeQueueSize) || encoder.encodeQueueSize < 0) {
    throw new RangeError("encoder queue size must be finite and non-negative");
  }
  if (signal?.aborted) throw abortError();
  if (encoder.encodeQueueSize <= 0) return;
  const addEventListener = encoder.addEventListener?.bind(encoder);
  const removeEventListener = encoder.removeEventListener?.bind(encoder);
  if (!addEventListener || !removeEventListener) {
    if (encoder.flush) {
      await awaitWithSignal(encoder.flush(), signal, failure);
    } else {
      while (encoder.encodeQueueSize > 0) {
        await awaitWithSignal(new Promise((resolve) => setTimeout(resolve, 0)), signal, failure);
      }
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      removeEventListener("dequeue", onDequeue);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onDequeue = (): void => {
      if (encoder.encodeQueueSize <= 0) finish(resolve);
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    addEventListener("dequeue", onDequeue);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (failure) {
      void failure.then(
        (reason) => finish(() => reject(asError(reason))),
        (reason) => finish(() => reject(asError(reason))),
      );
    }
    onDequeue();
  });
}

/** One encoder output waiting for its turn, so its metadata is not dropped. */
interface QueuedChunk {
  chunk: EncodedVideoChunk;
  meta?: EncodedVideoChunkMetadata;
}

/**
 * Holds encoder output until it can be handed on in DTS order.
 *
 * `encodeFrame` stamps each frame with `index * frameDuration`, so the input is
 * already ordered. The encoder's output is not: it comes back in decode order,
 * and a profile that uses B-frames transposes neighbouring pictures, so the
 * chunk for frame 2 can arrive before the chunk for frame 1. The muxer rejects
 * anything that is not monotonically increasing, which is the "DTS went from
 * 166667 to 83333" failure. Holding each chunk until its index comes up makes
 * the order correct whatever the encoder does.
 */
export function createChunkReorderer(
  write: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void,
  frameDuration: number,
): {
  push: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  settle: () => void;
} {
  if (!Number.isFinite(frameDuration) || frameDuration <= 0) {
    throw new RangeError("frame duration must be a finite positive number");
  }
  const held = new Map<number, QueuedChunk>();
  let next = 0;

  return {
    push(chunk, meta) {
      held.set(Math.round(chunk.timestamp / frameDuration), { chunk, meta });
      // Only the next index may go out, so the write order is 0, 1, 2 ...
      let ready = held.get(next);
      while (ready) {
        held.delete(next);
        write(ready.chunk, ready.meta);
        next++;
        ready = held.get(next);
      }
    },
    /** Whatever is left once the source is exhausted, still in DTS order. */
    settle() {
      for (const index of [...held.keys()].sort((a, b) => a - b)) {
        const entry = held.get(index)!;
        held.delete(index);
        write(entry.chunk, entry.meta);
      }
      next = 0;
    },
  };
}

export function encodeFrame(
  encoder: VideoEncoder,
  frame: ExportFrame,
  index: number,
  fps: number,
): void {
  validateExportFrame(frame);
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("fps must be finite and positive");
  const frameDuration = 1_000_000 / fps;
  let videoFrame: VideoFrame | undefined;
  try {
    videoFrame = new VideoFrame(frame.data, {
      format: "RGBA",
      codedWidth: frame.width,
      codedHeight: frame.height,
      timestamp: Math.round(index * frameDuration),
      duration: Math.round(frameDuration),
    });
    encoder.encode(videoFrame, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 });
  } finally {
    videoFrame?.close();
  }
}

export async function exportMp4(
  frames: ExportFrameSource,
  fps: number,
  onProgress?: (done: number, total: number) => void,
  options: ExportOptions = {},
): Promise<Blob> {
  if (!canExportMp4()) throw new Error("WebCodecs VideoEncoder not available in this browser");
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("fps must be finite and positive");
  const signal = options.signal ?? options.controller?.signal;
  throwIfAborted(signal);
  const total = totalFrames(options.total ?? (Array.isArray(frames) ? frames.length : undefined));
  const maxBytes = validateExportByteCap(options.maxBytes);
  const iterator = asyncFrameIterator(frames);
  let sourceDone = false;
  let first: ExportFrame | undefined;
  let encoder: VideoEncoder | undefined;
  let muxer: Muxer<ArrayBufferTarget> | undefined;
  let encoderFailure: Promise<never> | undefined;
  let rejectFailure: ((reason: unknown) => void) | undefined;
  let encoderError: Error | undefined;
  let encodedBytes = 0;
  let finished = false;

  try {
    const firstResult = await nextExportFrame(iterator, signal);
    if (firstResult.done) throw new Error("no frames to export");
    first = firstResult.value;
    validateExportFrame(first);
    throwIfAborted(signal);

    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: first.width, height: first.height },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    const reorder = createChunkReorderer((chunk, meta) => {
      muxer?.addVideoChunk(chunk, meta);
    }, 1_000_000 / fps);
    encoderFailure = new Promise<never>((_, reject) => {
      rejectFailure = reject;
    });
    void encoderFailure.catch(() => {});
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const chunkBytes = Number.isSafeInteger(chunk.byteLength) ? chunk.byteLength : 0;
        if (encodedBytes + chunkBytes > maxBytes) {
          encoderError = exportByteCapError(maxBytes);
          rejectFailure?.(encoderError);
          return;
        }
        encodedBytes += chunkBytes;
        try {
          // Decode order is not presentation order, so a chunk can arrive a
          // frame early and must wait for its turn.
          reorder.push(chunk, meta);
        } catch (error) {
          encoderError = asError(error);
          rejectFailure?.(encoderError);
        }
      },
      error: (error) => {
        encoderError = asError(error);
        rejectFailure?.(encoderError);
      },
    });
    encoder.configure({
      codec: avcCodecString(first.width, first.height),
      width: first.width,
      height: first.height,
      bitrate: targetBitrate(first.width, first.height, fps),
    });

    let frame: ExportFrame | undefined = first;
    let index = 0;
    while (frame) {
      throwIfAborted(signal);
      if (encoderError) throw encoderError;
      await waitForEncoderCapacity(encoder as unknown as EncoderCapacity, signal, encoderFailure);
      if (encoderError) throw encoderError;
      encodeFrame(encoder, frame, index, fps);
      index++;
      onProgress?.(index, total);
      throwIfAborted(signal);
      const next = await nextExportFrame(iterator, signal, encoderFailure);
      if (next.done) {
        sourceDone = true;
        frame = undefined;
      } else {
        frame = next.value;
        validateExportFrame(frame);
        if (frame.width !== first.width || frame.height !== first.height) {
          throw new Error("all export frames must have the same dimensions");
        }
      }
    }

    await Promise.race([awaitWithSignal(encoder.flush(), signal), encoderFailure]);
    throwIfAborted(signal);
    if (encoderError) throw encoderError;
    // A flush can also emit out of order, so the tail is settled here.
    reorder.settle();
    muxer.finalize();
    const buffer = muxer.target.buffer;
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("MP4 muxer did not produce a finalized buffer");
    }
    if (buffer.byteLength > maxBytes) throw exportByteCapError(maxBytes);
    const blob = new Blob([buffer], { type: "video/mp4" });
    finished = true;
    return blob;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    if (!finished) abortUpstream(options);
    if (encoder) {
      try {
        encoder.close();
      } catch {
        encoder = undefined;
      }
    }
    try {
      await closeExportIterator(iterator, signal, sourceDone, !finished);
    } catch {}
  }
}
