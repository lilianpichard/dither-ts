import { useCallback, useEffect, useState } from "react";

/** Which side each panel hangs off. */
export type RailSide = "left" | "right";
export type ConsoleSide = "bottom" | "right";

export interface Layout {
  railSide: RailSide;
  consoleSide: ConsoleSide;
}

const DEFAULT_LAYOUT: Layout = { railSide: "left", consoleSide: "bottom" };
const STORAGE_KEY = "dither-ts.layout.v1";

function parse(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(raw) as Partial<Layout>;
    return {
      railSide: value.railSide === "right" ? "right" : "left",
      consoleSide: value.consoleSide === "right" ? "right" : "bottom",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * The shell's shape. Only the arrangement lives here: the sizes stay with the
 * panels, so a change here is a preference and not something being edited.
 * Read in an effect rather than during render, because there is nothing to paint
 * until the window exists and the alternative is a flash of the wrong layout.
 */
export function useLayout() {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);

  useEffect(() => {
    try {
      setLayout(parse(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage unreadable: the default arrangement stands.
    }
  }, []);

  const update = useCallback((next: Partial<Layout>) => {
    setLayout((current) => {
      const merged = { ...current, ...next };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // Private mode or a full quota: the choice lasts for this session.
      }
      return merged;
    });
  }, []);

  return { layout, update };
}
