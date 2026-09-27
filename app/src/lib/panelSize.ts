import { useCallback, useEffect, useState } from "react";

const read = (key: string, fallback: number): number => {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
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
