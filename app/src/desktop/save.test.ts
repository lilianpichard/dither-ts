import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "./bridge";
import { pickOutputFolder, saveBlob, saveText } from "./save";

/** What the browser download flow does, captured instead of performed. */
function stubDownload() {
  const clicks: { href: string; download: string }[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor = {
        href: "",
        download: "",
        click: () => clicks.push({ href: anchor.href, download: anchor.download }),
      };
      return anchor;
    },
  });
  return clicks;
}

function expose(bridge: Partial<DesktopBridge>): DesktopBridge {
  const full = {
    versions: { node: "22.0.0", chrome: "140", electron: "44.0.0" },
    open: vi.fn(async () => ({ canceled: true, files: [] })),
    pickDirectory: vi.fn(async () => ({ canceled: true, handle: null })),
    save: vi.fn(async () => ({ canceled: false, path: "/tmp/dither.png" })),
    ...bridge,
  } as DesktopBridge;
  vi.stubGlobal("window", { ditherDesktop: full });
  return full;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveBlob in a browser", () => {
  it("falls back to a download, and reports a real save", async () => {
    const clicks = stubDownload();
    expect(await saveBlob("dither.png", new Blob([new Uint8Array([1, 2, 3])]))).toBe("saved");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe("dither.png");
    expect(clicks[0].href).toMatch(/^blob:/);
  });

  it("has no output folder to pick without the shell", async () => {
    expect(await pickOutputFolder()).toBeNull();
  });
});

describe("saveBlob in the shell", () => {
  it("sends the bytes and no folder for a save dialog", async () => {
    const bridge = expose({});
    expect(await saveBlob("dither.png", new Blob([new Uint8Array([1, 2, 3])]))).toBe("saved");
    expect(bridge.save).toHaveBeenCalledWith({
      name: "dither.png",
      bytes: new Uint8Array([1, 2, 3]),
      directory: null,
    });
  });

  it("addresses a picked folder by its handle", async () => {
    const bridge = expose({});
    await saveBlob("dither.png", new Blob([new Uint8Array([1])]), { directory: "handle-1" });
    expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({ directory: "handle-1" }));
  });

  it("does not also start a browser download", async () => {
    const clicks = stubDownload();
    expose({});
    await saveBlob("dither.png", new Blob([new Uint8Array([1])]));
    expect(clicks).toEqual([]);
  });

  it("reports a cancelled dialog without claiming a save", async () => {
    expose({ save: vi.fn(async () => ({ canceled: true, path: null })) });
    expect(await saveBlob("dither.png", new Blob([new Uint8Array([1])]))).toBe("cancelled");
  });

  it("sends generated text as a blob of its own type", async () => {
    const bridge = expose({});
    expect(await saveText("<svg/>", "dither.svg", "image/svg+xml")).toBe("saved");
    const call = vi.mocked(bridge.save).mock.calls[0][0];
    expect(call.name).toBe("dither.svg");
    expect([...call.bytes]).toEqual([60, 115, 118, 103, 47, 62]);
  });

  it("returns the folder handle, and nothing for a cancelled pick", async () => {
    expose({ pickDirectory: vi.fn(async () => ({ canceled: false, handle: "handle-1" })) });
    expect(await pickOutputFolder()).toBe("handle-1");
    expose({ pickDirectory: vi.fn(async () => ({ canceled: true, handle: null })) });
    expect(await pickOutputFolder()).toBeNull();
  });
});
