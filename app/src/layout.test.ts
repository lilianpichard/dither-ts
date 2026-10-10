import { beforeEach, describe, expect, it, vi } from "vitest";

// A window is only needed for the storage the layout persists to, so a stub of
// the one field it touches is enough and no DOM implementation is required.
function stubStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
  vi.stubGlobal("window", { localStorage: storage });
  return { data, storage };
}

describe("layout store", () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it("starts on the left rail and the bottom console", async () => {
    const { useLayout } = await import("./layout");
    const state = useLayout.getState();
    expect(state.railSide).toBe("left");
    expect(state.consoleSide).toBe("bottom");
  });

  it("writes a change to storage, so a reload finds it", async () => {
    const { useLayout } = await import("./layout");
    useLayout.getState().setRailSide("right");
    const raw = JSON.parse(window.localStorage.getItem("dither-ts.layout.v1") ?? "");
    expect(raw.railSide).toBe("right");
    // The console is untouched, because a merge keeps the field it did not write.
    expect(raw.consoleSide).toBe("bottom");
    useLayout.getState().setConsoleSide("top");
    const both = JSON.parse(window.localStorage.getItem("dither-ts.layout.v1") ?? "");
    expect(both).toEqual({ railSide: "right", consoleSide: "top" });
  });

  it("reads a saved arrangement back on the first render", async () => {
    // A reload is the only way a preference from a previous session is honoured,
    // so the read has to happen when the store is built rather than after paint.
    stubStorage({
      "dither-ts.layout.v1": JSON.stringify({ railSide: "right", consoleSide: "left" }),
    });
    const { useLayout } = await import("./layout");
    expect(useLayout.getState().railSide).toBe("right");
    expect(useLayout.getState().consoleSide).toBe("left");
  });

  it("falls back to the default for a value it does not know", async () => {
    stubStorage({ "dither-ts.layout.v1": "not json" });
    const { useLayout } = await import("./layout");
    expect(useLayout.getState()).toMatchObject({ railSide: "left", consoleSide: "bottom" });
  });

  it("refuses an edge no longer offered, rather than drawing a panel nowhere", async () => {
    stubStorage({
      "dither-ts.layout.v1": JSON.stringify({ railSide: "nowhere", consoleSide: "middle" }),
    });
    const { useLayout } = await import("./layout");
    expect(useLayout.getState()).toMatchObject({ railSide: "left", consoleSide: "bottom" });
  });

  it("survives storage that throws, which private mode and a full quota do", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {},
      },
    });
    const { useLayout } = await import("./layout");
    // The choice then lasts for the session rather than being lost.
    useLayout.getState().setConsoleSide("right");
    expect(useLayout.getState().consoleSide).toBe("right");
  });

  it("clears the saved arrangement on reset", async () => {
    const { useLayout } = await import("./layout");
    useLayout.getState().setConsoleSide("right");
    useLayout.getState().reset();
    expect(window.localStorage.getItem("dither-ts.layout.v1")).toBeNull();
    expect(useLayout.getState()).toMatchObject({ railSide: "left", consoleSide: "bottom" });
  });
});
