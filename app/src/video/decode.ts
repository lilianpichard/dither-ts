import type { ClipInfo } from "./jobs";

export interface LoadedClip {
  url: string;
  element: HTMLVideoElement;
  info: ClipInfo;
  revoke: () => void;
}

export const SEEK_TIMEOUT_MS = 10_000;
export const LOAD_TIMEOUT_MS = 10_000;
const SEEK_EPSILON = 0.001;
const HAVE_CURRENT_DATA = 2;

export interface SeekOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  timeout?: number;
}

export interface LoadClipOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  timeout?: number;
}

export interface CaptureFrameOptions extends SeekOptions {
  /** Grab whatever the element is showing right now instead of seeking to `time`. */
  live?: boolean;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function captureAbortError(): Error {
  const error = new Error("video capture aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function validateTimeout(timeoutMs: number, label = "seek"): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`${label} timeout must be a finite non-negative number`);
  }
}

function isAbortSignal(value: SeekOptions | LoadClipOptions | AbortSignal): value is AbortSignal {
  return typeof value === "object" && value !== null && "aborted" in value;
}

function normalizeSeekOptions<T extends SeekOptions>(value: T | AbortSignal): T {
  return isAbortSignal(value) ? ({ signal: value } as T) : value;
}

export function waitForSeek(
  element: HTMLVideoElement,
  options: SeekOptions | AbortSignal = {},
  seek?: () => void,
): Promise<void> {
  const normalized = normalizeSeekOptions(options);
  const timeoutMs = normalized.timeoutMs ?? normalized.timeout ?? SEEK_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  if (normalized.signal?.aborted) return Promise.reject(captureAbortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("error", onError);
      normalized.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onSeeked = (): void => finish(resolve);
    const onError = (): void => finish(() => reject(new Error("video seek failed")));
    const onAbort = (): void => finish(() => reject(captureAbortError()));

    element.addEventListener("seeked", onSeeked);
    element.addEventListener("error", onError);
    normalized.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`video seek timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      finish(() => reject(error));
    }, timeoutMs);

    try {
      seek?.();
    } catch (error) {
      finish(() => reject(asError(error)));
    }
  });
}

function waitForMetadata(element: HTMLVideoElement, options: LoadClipOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? options.timeout ?? LOAD_TIMEOUT_MS;
  validateTimeout(timeoutMs, "video load");
  if (options.signal?.aborted) return Promise.reject(captureAbortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      element.removeEventListener("loadedmetadata", onLoaded);
      element.removeEventListener("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onLoaded = (): void => finish(resolve);
    const onError = (): void => finish(() => reject(new Error("video load failed")));
    const onAbort = (): void => finish(() => reject(captureAbortError()));
    element.addEventListener("loadedmetadata", onLoaded);
    element.addEventListener("error", onError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`video load timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      finish(() => reject(error));
    }, timeoutMs);
    if (options.signal?.aborted) onAbort();
  });
}

function waitForVideoData(element: HTMLVideoElement, options: CaptureFrameOptions): Promise<void> {
  if (element.readyState >= HAVE_CURRENT_DATA) return Promise.resolve();
  const timeoutMs = options.timeoutMs ?? options.timeout ?? SEEK_TIMEOUT_MS;
  validateTimeout(timeoutMs);
  if (options.signal?.aborted) return Promise.reject(captureAbortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      element.removeEventListener("loadeddata", onLoaded);
      element.removeEventListener("error", onError);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onLoaded = (): void => finish(resolve);
    const onError = (): void => finish(() => reject(new Error("video data failed")));
    const onAbort = (): void => finish(() => reject(captureAbortError()));
    element.addEventListener("loadeddata", onLoaded);
    element.addEventListener("error", onError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`video data timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      finish(() => reject(error));
    }, timeoutMs);
    if (element.readyState >= HAVE_CURRENT_DATA) onLoaded();
    if (options.signal?.aborted) onAbort();
  });
}

export async function loadClip(
  file: File,
  options: LoadClipOptions | AbortSignal = {},
): Promise<LoadedClip> {
  const normalized = normalizeSeekOptions(options);
  const timeoutMs = normalized.timeoutMs ?? normalized.timeout ?? LOAD_TIMEOUT_MS;
  validateTimeout(timeoutMs, "video load");
  if (normalized.signal?.aborted) throw captureAbortError();
  const url = URL.createObjectURL(file);
  let revoked = false;
  const revoke = (): void => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };
  try {
    const element = document.createElement("video");
    element.muted = true;
    element.preload = "auto";
    const metadata = waitForMetadata(element, {
      signal: normalized.signal,
      timeoutMs,
    });
    void metadata.catch(() => {});
    element.src = url;
    await metadata;
    if (normalized.signal?.aborted) throw captureAbortError();
    return {
      url,
      element,
      info: {
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
      },
      revoke,
    };
  } catch (error) {
    revoke();
    throw normalized.signal?.aborted ? captureAbortError() : error;
  }
}

export async function loadReplacement(
  current: LoadedClip | null,
  file: File,
  options: LoadClipOptions | AbortSignal = {},
): Promise<LoadedClip> {
  const normalized = normalizeSeekOptions(options);
  const replacement = await loadClip(file, normalized);
  if (normalized.signal?.aborted) {
    replacement.revoke();
    throw captureAbortError();
  }
  if (current !== replacement) current?.revoke();
  return replacement;
}

function validateCaptureSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("capture width and height must be finite positive integers");
  }
}

export function captureFrame(
  clip: LoadedClip,
  time: number,
  width: number,
  height: number,
  options?: CaptureFrameOptions,
): Promise<ImageData>;
export function captureFrame(
  clip: LoadedClip,
  time: number,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<ImageData>;
export async function captureFrame(
  clip: LoadedClip,
  time: number,
  width: number,
  height: number,
  options: CaptureFrameOptions | AbortSignal = {},
): Promise<ImageData> {
  const normalized = normalizeSeekOptions(options);
  validateCaptureSize(width, height);
  if (!Number.isFinite(time)) throw new RangeError("capture time must be finite");
  if (!Number.isFinite(clip.info.duration) || clip.info.duration <= 0) {
    throw new RangeError("clip duration must be a finite positive number");
  }
  if (normalized.signal?.aborted) throw captureAbortError();

  const { element } = clip;
  const target = Math.min(Math.max(0, time), Math.max(0, clip.info.duration - 0.04));
  // A playing element is already advancing, so seeking to `time` would fight playback.
  const sameTime =
    normalized.live ||
    (!element.seeking &&
      Number.isFinite(element.currentTime) &&
      Math.abs(element.currentTime - target) <= SEEK_EPSILON);
  if (!sameTime) {
    await waitForSeek(element, normalized, () => {
      element.currentTime = target;
    });
  }
  if (normalized.signal?.aborted) throw captureAbortError();
  await waitForVideoData(element, normalized);
  if (normalized.signal?.aborted) throw captureAbortError();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("video canvas context unavailable");
  context.drawImage(element, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}
