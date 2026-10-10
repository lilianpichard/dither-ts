import { create } from "zustand";

/** Which side of the canvas each panel hangs off. */
export type RailSide = "left" | "right";
export type ConsoleSide = "top" | "right" | "bottom" | "left";

export interface Layout {
  railSide: RailSide;
  consoleSide: ConsoleSide;
}

const DEFAULT_LAYOUT: Layout = { railSide: "left", consoleSide: "bottom" };
const STORAGE_KEY = "dither-ts.layout.v1";

/**
 * Read the saved arrangement back. Anything unrecognised falls back to the
 * default rather than being rejected, because a half-valid layout still has to
 * paint something.
 */
function parseLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(raw) as Partial<Layout>;
    return {
      railSide: value.railSide === "right" ? "right" : "left",
      consoleSide: (["top", "right", "bottom", "left"] as const).includes(
        value.consoleSide as never,
      )
        ? (value.consoleSide as ConsoleSide)
        : "bottom",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function readStorage(): Layout {
  try {
    return parseLayout(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

interface LayoutStore {
  railSide: RailSide;
  consoleSide: ConsoleSide;
  setRailSide: (side: RailSide) => void;
  setConsoleSide: (side: ConsoleSide) => void;
  reset: () => void;
}

/** Save an arrangement, or say nothing when storage refuses it. */
function writeStorage(next: Layout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the choice then lasts for this session.
  }
}

/**
 * The shell's shape. One store, because a layout that is local state is a layout
 * that only takes effect when the component that owns it remounts: the shell and
 * the drag handle would each hold their own copy and the two would disagree
 * until a reload. Read during the first render rather than in an effect, so the
 * saved arrangement paints first time with no flash of the default.
 */
export const useLayout = create<LayoutStore>()((set) => ({
  ...readStorage(),
  setRailSide: (railSide) =>
    set((current) => {
      const next = { ...current, railSide };
      writeStorage(next);
      return next;
    }),
  setConsoleSide: (consoleSide) =>
    set((current) => {
      const next = { ...current, consoleSide };
      writeStorage(next);
      return next;
    }),
  reset: () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode or a full quota: the default layout stands anyway.
    }
    set(DEFAULT_LAYOUT);
  },
}));
