import { useCallback, useEffect, useRef, useState } from "react";
import type { Point, Rect } from "./dock";
import { resolveDockZone } from "./dock";

export type DockPanel = "rail" | "console";

interface DragState {
  panel: DockPanel;
  /** Where the drag started, so a click without a move is not a dock. */
  from: Point;
  now: Point;
  /** The rectangle the zones are drawn over, captured when the drag began. */
  rect: Rect;
  zone: string | null;
}

/**
 * How far the pointer has to travel before a press counts as a drag. Without
 * a reach, a shaky click on the handle would dock the panel somewhere.
 */
export const DOCK_REACH = 4;

/** Whether a pointer press has become a drag rather than a click. */
export function hasMoved(from: Point, to: Point, reach = DOCK_REACH): boolean {
  return Math.abs(to.x - from.x) > reach || Math.abs(to.y - from.y) > reach;
}

/**
 * Drag a panel to the edge of the canvas and drop it there.
 *
 * The zone is recomputed on every move rather than on drop, so the highlight
 * follows the pointer and the answer the user sees is the answer they get. The
 * rectangle is captured at the start: reading it live would let a panel that
 * resizes mid-drag change which edge the pointer is over.
 *
 * `onDock` fires only if the pointer actually moved, so a stray click on the
 * handle does not silently re-dock the panel.
 */
export function useDockDrag(onDock: (panel: DockPanel, side: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // The live gesture, kept in a ref as well as in state: the release has to
  // read the last move that was seen, and a pointerup can arrive without a
  // re-render in between.
  const live = useRef<DragState | null>(null);
  const moved = useRef(false);
  const onDockRef = useRef(onDock);
  onDockRef.current = onDock;

  const start = useCallback((panel: DockPanel, event: React.PointerEvent, rect: Rect) => {
    if (event.button !== 0) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    moved.current = false;
    const from = { x: event.clientX, y: event.clientY };
    live.current = { panel, from, now: from, rect, zone: null };
    setDrag(live.current);
  }, []);

  const move = useCallback((event: React.PointerEvent) => {
    const current = live.current;
    if (!current) return;
    const now = { x: event.clientX, y: event.clientY };
    // A press that has not yet travelled the reach is a click, so it stays put
    // rather than lighting up a zone the user has not aimed at.
    if (!moved.current) {
      if (!hasMoved(current.from, now)) return;
      moved.current = true;
    }
    live.current = { ...current, now, zone: resolveDockZone(now, current.rect) };
    setDrag(live.current);
  }, []);

  const end = useCallback((event: React.PointerEvent) => {
    const current = live.current;
    // A press that started with the wrong button, or was cancelled, has nothing
    // to commit; releasing a capture that was never taken would also throw.
    if (current) {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      if (moved.current && current.zone) onDockRef.current(current.panel, current.zone);
    }
    live.current = null;
    moved.current = false;
    setDrag(null);
  }, []);

  // Escape cancels a drag mid-flight, so a handle grabbed by mistake can be
  // abandoned without dropping the panel somewhere unintended.
  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      live.current = null;
      moved.current = false;
      setDrag(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);

  return { drag, start, move, end };
}
