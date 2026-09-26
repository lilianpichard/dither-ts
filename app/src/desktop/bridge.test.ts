import { afterEach, describe, expect, it, vi } from "vitest";
import { canOpenFiles, desktopBridge, type DesktopBridge } from "./bridge";

/** A bridge that records what the app asked the shell to do. */
function stubBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    versions: { node: "22.0.0", chrome: "140", electron: "44.0.0" },
    open: vi.fn(async () => ({ canceled: true, files: [] })),
    pickDirectory: vi.fn(async () => ({ canceled: true, handle: null })),
    save: vi.fn(async () => ({ canceled: true, path: null })),
    ...overrides,
  };
}

function expose(bridge: unknown): void {
  vi.stubGlobal("window", { ditherDesktop: bridge });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("desktopBridge", () => {
  it("is absent in a plain browser", () => {
    expose(undefined);
    expect(desktopBridge()).toBeNull();
    expect(canOpenFiles()).toBe(false);
  });

  it("is absent when there is no window at all", () => {
    expect(desktopBridge()).toBeNull();
    expect(canOpenFiles()).toBe(false);
  });

  it("is used when the shell exposed a complete bridge", () => {
    const bridge = stubBridge();
    expose(bridge);
    expect(desktopBridge()).toBe(bridge);
    expect(canOpenFiles()).toBe(true);
  });

  it("is ignored unless every channel is callable", () => {
    const partials = [
      null,
      "ditherDesktop",
      {},
      { open: () => {} },
      { open: () => {}, pickDirectory: () => {} },
      { open: 1, pickDirectory: () => {}, save: () => {} },
      [stubBridge()],
    ];
    for (const partial of partials) {
      expose(partial);
      expect(desktopBridge()).toBeNull();
    }
  });
});
