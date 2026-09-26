import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge, DesktopFile } from "./bridge";
import { openFailure, openFiles, openImage } from "./files";

/** Bytes for one file, as the main process would send them. */
function payload(name: string, type: string, bytes: number[]): DesktopFile {
  return { name, type, bytes: new Uint8Array(bytes) };
}

function expose(bridge: Partial<DesktopBridge>): DesktopBridge {
  const full = {
    versions: { node: "22.0.0", chrome: "140", electron: "44.0.0" },
    open: vi.fn(async () => ({ canceled: true, files: [] })),
    pickDirectory: vi.fn(async () => ({ canceled: true, handle: null })),
    save: vi.fn(async () => ({ canceled: true, path: null })),
    ...bridge,
  } as DesktopBridge;
  vi.stubGlobal("window", { ditherDesktop: full });
  return full;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openFiles", () => {
  it("reports no bridge so the caller keeps its file input", async () => {
    expect(await openFiles("image")).toBeNull();
  });

  it("asks for the kind and multiplicity that was asked for", async () => {
    const bridge = expose({});
    await openFiles("video", { multiple: true });
    expect(bridge.open).toHaveBeenCalledWith({ kind: "video", multiple: true });
    await openFiles("image");
    expect(bridge.open).toHaveBeenLastCalledWith({ kind: "image", multiple: false });
  });

  it("rebuilds each chosen file the app can decode", async () => {
    expose({
      open: vi.fn(async () => ({
        canceled: false,
        files: [
          payload("shot.png", "image/png", [1, 2, 3]),
          payload("clip.mp4", "video/mp4", [4, 5]),
        ],
      })),
    });
    const files = await openFiles("image", { multiple: true });
    expect(files?.map((file) => [file.name, file.type, file.size])).toEqual([
      ["shot.png", "image/png", 3],
      ["clip.mp4", "video/mp4", 2],
    ]);
    expect([...new Uint8Array(await files![0].arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("keeps only the bytes it was given, not the whole view", async () => {
    const wide = new Uint8Array([9, 9, 1, 2, 9]).subarray(2, 4);
    expose({
      open: vi.fn(async () => ({
        canceled: false,
        files: [{ name: "a.png", type: "image/png", bytes: wide }],
      })),
    });
    const files = await openFiles("image");
    // The view goes into the File as it is; nothing is copied to line it up.
    expect([...new Uint8Array(await files![0].arrayBuffer())]).toEqual([1, 2]);
  });

  it("lets a bridge failure through so the caller can report it", async () => {
    expose({
      open: vi.fn(async () => {
        throw new Error("huge.png is over the 256 MB limit for a image");
      }),
    });
    await expect(openFiles("image")).rejects.toThrow("huge.png is over the 256 MB limit");
    expect(openFailure(new Error("boom"))).toBe("boom");
    expect(openFailure("plain")).toBe("plain");
  });

  it("carries a whole payload through without losing a byte", async () => {
    const bytes = new Uint8Array(1 << 20);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    expose({
      open: vi.fn(async () => ({
        canceled: false,
        files: [{ name: "big.png", type: "image/png", bytes }],
      })),
    });
    const files = await openFiles("image");
    const read = new Uint8Array(await files![0].arrayBuffer());
    expect(read.length).toBe(bytes.length);
    expect(read[0]).toBe(0);
    expect(read[bytes.length - 1]).toBe((bytes.length - 1) % 251);
  });

  it("reads a cancelled dialog as no files", async () => {
    expose({
      open: vi.fn(async () => ({
        canceled: true,
        files: [{ name: "a.png", type: "image/png", bytes: new Uint8Array([1]) }],
      })),
    });
    expect(await openFiles("image")).toEqual([]);
    expect(await openImage()).toBeNull();
  });

  it("takes the first file when one image was asked for", async () => {
    expose({
      open: vi.fn(async () => ({
        canceled: false,
        files: [payload("a.png", "image/png", [1]), payload("b.png", "image/png", [2])],
      })),
    });
    expect((await openImage())?.name).toBe("a.png");
  });
});
