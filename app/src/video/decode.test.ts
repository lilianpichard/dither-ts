import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFrame, loadReplacement, loadClip, waitForSeek } from "./decode";

class FakeVideo {
  currentTime = 0;
  videoWidth = 2;
  videoHeight = 3;
  duration = 4;
  readyState = 4;
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    const event = { type } as Event;
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function video(value: FakeVideo): HTMLVideoElement {
  return value as unknown as HTMLVideoElement;
}

function clip(value: FakeVideo): Parameters<typeof captureFrame>[0] {
  return {
    url: "blob:test",
    element: video(value),
    info: { duration: 2, width: 1, height: 1 },
    revoke: () => {},
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("video seek waiting", () => {
  it("cleans listeners when aborted", async () => {
    const element = new FakeVideo();
    const controller = new AbortController();
    const pending = waitForSeek(video(element), { signal: controller.signal }, () => {});
    expect(element.count("seeked")).toBe(1);
    expect(element.count("error")).toBe(1);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(element.count("seeked")).toBe(0);
    expect(element.count("error")).toBe(0);
  });

  it("times out and removes listeners", async () => {
    vi.useFakeTimers();
    const element = new FakeVideo();
    const pending = waitForSeek(video(element), { timeoutMs: 25 });
    const rejection = expect(pending).rejects.toThrow(/timed out.*25ms/);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(element.count("seeked")).toBe(0);
    expect(element.count("error")).toBe(0);
  });
});

describe("captureFrame", () => {
  it("does not seek again when the requested time is already current", async () => {
    const element = new FakeVideo();
    element.currentTime = 1.96;
    let drawn = 0;
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {
            drawn++;
          },
          getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        }),
      }),
    });
    await captureFrame(clip(element), 2, 1, 1);
    expect(drawn).toBe(1);
    expect(element.count("seeked")).toBe(0);
  });

  it("waits for current video data at time zero", async () => {
    const element = new FakeVideo();
    element.readyState = 0;
    let drawn = 0;
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {
            drawn++;
          },
          getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        }),
      }),
    });
    const pending = captureFrame(clip(element), 0, 1, 1, { timeoutMs: 100 });
    expect(drawn).toBe(0);
    element.emit("loadeddata");
    await expect(pending).resolves.toBeDefined();
    expect(drawn).toBe(1);
  });

  it("grabs the frame on screen when live, without seeking a playing element", async () => {
    const element = new FakeVideo();
    element.currentTime = 0.5;
    let drawn = 0;
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {
            drawn++;
          },
          getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
        }),
      }),
    });
    // A live capture targets 1.5s while the element sits at 0.5s: it must not seek.
    await captureFrame(clip(element), 1.5, 1, 1, { live: true });
    expect(drawn).toBe(1);
    expect(element.currentTime).toBe(0.5);
    expect(element.count("seeked")).toBe(0);
  });
});

describe("video loading", () => {
  it("aborts loading and revokes the object URL once", async () => {
    const created: FakeVideo[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:test-${created.length}`),
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const value = new FakeVideo();
        created.push(value);
        return video(value);
      },
    });
    const controller = new AbortController();
    const pending = loadClip({} as File, { signal: controller.signal, timeout: 100 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(created[0].count("loadedmetadata")).toBe(0);
  });

  it("accepts a bare AbortSignal when loading", async () => {
    const created: FakeVideo[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:signal-${created.length}`),
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const value = new FakeVideo();
        created.push(value);
        return video(value);
      },
    });
    const controller = new AbortController();
    const pending = loadClip({} as File, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(created[0].count("loadedmetadata")).toBe(0);
  });

  it("keeps the old clip when replacement loading is aborted", async () => {
    const created: FakeVideo[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:replacement-${created.length}`),
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const value = new FakeVideo();
        created.push(value);
        return video(value);
      },
    });
    const oldRevoke = vi.fn();
    const old = { ...clip(new FakeVideo()), revoke: oldRevoke };
    const controller = new AbortController();
    const pending = loadReplacement(old, {} as File, {
      signal: controller.signal,
      timeout: 100,
    });
    created[0].emit("loadedmetadata");
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(oldRevoke).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("times out metadata loading and revokes the object URL", async () => {
    vi.useFakeTimers();
    const created: FakeVideo[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:timeout"),
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const value = new FakeVideo();
        created.push(value);
        return video(value);
      },
    });
    const pending = loadClip({} as File, { timeout: 25 });
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(created[0].count("loadedmetadata")).toBe(0);
  });

  it("keeps the old clip until a replacement loads successfully", async () => {
    const created: FakeVideo[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:test-${created.length}`),
      revokeObjectURL,
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const value = new FakeVideo();
        created.push(value);
        return video(value);
      },
    });
    const oldRevoke = vi.fn();
    const old = { ...clip(new FakeVideo()), revoke: oldRevoke };
    const file = {} as File;
    const failed = loadReplacement(old, file, { timeout: 100 });
    created[0].emit("error");
    await expect(failed).rejects.toThrow(/load/i);
    expect(oldRevoke).not.toHaveBeenCalled();
    const loaded = loadReplacement(old, file, { timeout: 100 });
    created[1].emit("loadedmetadata");
    const replacement = await loaded;
    expect(oldRevoke).toHaveBeenCalledTimes(1);
    expect(replacement.info).toEqual({ duration: 4, width: 2, height: 3 });
    replacement.revoke();
    replacement.revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
