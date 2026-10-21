import { useCallback, useEffect, useState } from "react";

/** Stored extent, or the fallback when the value is missing or unusable. */
export function parsePanelSize(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Largest extent the panel can take without squeezing the canvas below its
 * minimum. The axis follows the panel's own side, and `neighbour` is the
 * extent the other panel already claims on that same axis.
 */
export function panelMaxExtent(
  bounds: { w: number; h: number },
  side: "left" | "right" | "top" | "bottom",
  neighbour: number,
  canvasMin: number,
): number {
  const available = side === "left" || side === "right" ? bounds.w : bounds.h;
  return Math.max(0, available - neighbour - canvasMin);
}

const read = (key: string, fallback: number): number => {
  try {
    return parsePanelSize(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
};

/**
 * Panel extent in pixels, persisted so a resized rail stays resized.
 * Returns 0 when the panel is collapsed.
 */
export function usePanelSize(key: string, fallback: number) {
  const [size, setSize] = useState(() => read(key, fallback));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(size));
    } catch {
      /* private mode or quota: the panel still resizes for this session */
    }
  }, [key, size]);

  const resize = useCallback((next: number) => setSize(Math.max(0, Math.round(next))), []);
  const toggle = useCallback(() => setSize((s) => (s > 0 ? 0 : fallback)), [fallback]);

  return { size, setSize, resize, toggle, collapsed: size === 0 };
}
