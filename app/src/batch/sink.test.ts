import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../desktop/bridge";
import {
  canPickDirectory,
  defaultSink,
  desktopSink,
  directorySink,
  pickDirectory,
  supportsDirectoryPicker,
  type DirectoryHandle,
} from "./sink";

/** The browser download flow, captured instead of performed. */
function stubDownload() {
  const clicks: string[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const anchor = {
        href: "",
        download: "",
        click: () => clicks.push(anchor.download),
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
    save: vi.fn(async () => ({ canceled: false, path: "/tmp/a.png" })),
    ...bridge,
  } as DesktopBridge;
  vi.stubGlobal("window", { ditherDesktop: full });
  return full;
}

/** A minimal writable directory handle, as the browser would hand one over. */
function stubDirectory(name: string): DirectoryHandle {
  const written: string[] = [];
  const handle = {
    kind: "directory" as const,
    name,
    getFileHandle: async (file: string) => ({
      createWritable: async () => ({
        write: async () => {
          written.push(file);
        },
        close: async () => {},
      }),
    }),
  };
  return Object.assign(handle, { written }) as DirectoryHandle & { written: string[] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultSink", () => {
  it("downloads every file when there is no shell", async () => {
    const clicks = stubDownload();
    const sink = defaultSink();
    expect(sink.label).toBe("Downloads");
    await sink.write("a.dither.png", new Blob([new Uint8Array([1])]));
    expect(clicks).toEqual(["a.dither.png"]);
  });

  it("goes through the shell's own save dialog when there is one", async () => {
    stubDownload();
    const bridge = expose({});
    const sink = defaultSink();
    expect(sink.label).not.toBe("Downloads");
    await sink.write("a.dither.png", new Blob([new Uint8Array([1, 2])]));
    expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({ directory: null }));
  });
});

describe("desktopSink", () => {
  it("writes into the folder it was given, by handle", async () => {
    const bridge = expose({});
    await desktopSink("handle-1").write("a.dither.png", new Blob([new Uint8Array([1])]));
    expect(bridge.save).toHaveBeenCalledWith({
      name: "a.dither.png",
      bytes: new Uint8Array([1]),
      directory: "handle-1",
    });
  });
});

describe("canPickDirectory", () => {
  it("is false in a browser with no file system access", () => {
    expect(supportsDirectoryPicker()).toBe(false);
    expect(canPickDirectory()).toBe(false);
  });

  it("is true when the shell can ask for a folder", () => {
    expose({});
    expect(canPickDirectory()).toBe(true);
  });

  it("is true when the browser can ask for one", () => {
    vi.stubGlobal("showDirectoryPicker", async () => stubDirectory("picked"));
    expect(canPickDirectory()).toBe(true);
  });
});

describe("pickDirectory", () => {
  it("prefers the browser's own directory picker", async () => {
    const dir = stubDirectory("picked");
    vi.stubGlobal("showDirectoryPicker", async () => dir);
    const sink = await pickDirectory();
    expect(sink?.label).toBe("picked");
    await sink!.write("a.dither.png", new Blob([new Uint8Array([1])]));
    expect((dir as unknown as { written: string[] }).written).toEqual(["a.dither.png"]);
  });

  it("falls back to the shell's folder dialog", async () => {
    expose({ pickDirectory: vi.fn(async () => ({ canceled: false, handle: "handle-1" })) });
    const sink = await pickDirectory();
    expect(sink).not.toBeNull();
    await sink!.write("a.dither.png", new Blob([new Uint8Array([1])]));
    expect(sink!.label).not.toBe("picked");
  });

  it("is null when the user cancels", async () => {
    expose({ pickDirectory: vi.fn(async () => ({ canceled: true, handle: null })) });
    expect(await pickDirectory()).toBeNull();
  });
});

describe("directorySink", () => {
  it("labels the folder and writes into it", async () => {
    const dir = stubDirectory("shots");
    const sink = directorySink(dir);
    expect(sink.label).toBe("shots");
    await sink.write("a.dither.png", new Blob([new Uint8Array([1])]));
    expect((dir as unknown as { written: string[] }).written).toEqual(["a.dither.png"]);
  });
});
