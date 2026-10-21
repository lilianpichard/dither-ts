import type { ConsoleSide, RailSide } from "./layout";

/** The four edges a panel can dock to, named as the user sees them. */
export type DockSide = "top" | "right" | "bottom" | "left";

export interface DockZone {
  side: DockSide;
  label: "dock.top" | "dock.right" | "dock.bottom" | "dock.left";
}

export const DOCK_ZONES: readonly DockZone[] = [
  { side: "top", label: "dock.top" },
  { side: "right", label: "dock.right" },
  { side: "bottom", label: "dock.bottom" },
  { side: "left", label: "dock.left" },
];

/** A rectangle in viewport coordinates. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Which edge a point falls on, measured from the centre of the rectangle.
 *
 * The dominant axis wins rather than a fixed band along each edge, because a
 * panel dropped near a corner should go somewhere sensible rather than nowhere:
 * comparing the two normalised distances picks the edge the pointer is actually
 * nearest, and the far edge wins when neither dominates, so a drop dead centre
 * lands on the longer axis rather than being ambiguous.
 */
export function resolveDockZone(point: Point, rect: Rect): DockSide {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const nx = Math.abs(dx) / (rect.width / 2);
  const ny = Math.abs(dy) / (rect.height / 2);

  if (nx >= ny) return dx < 0 ? "left" : "right";
  return dy < 0 ? "top" : "bottom";
}

/** The sides a panel is allowed to dock to. */
export function allowedSides(panel: "rail" | "console"): readonly DockSide[] {
  return panel === "rail" ? ["left", "right"] : ["top", "right", "bottom", "left"];
}

/** The side an arrow key points at, or null when the panel cannot go there. */
export function dockSideForKey(panel: "rail" | "console", key: string): DockSide | null {
  const side =
    key === "ArrowUp"
      ? "top"
      : key === "ArrowRight"
        ? "right"
        : key === "ArrowDown"
          ? "bottom"
          : key === "ArrowLeft"
            ? "left"
            : null;
  return side !== null && allowedSides(panel).includes(side) ? side : null;
}

/**
 * Drop a panel on a side, or leave it where it is when that side is not one it
 * may take. Returning the same layout on a refused drop means the caller can
 * assign the result unconditionally.
 */
export function dockLayout(
  layout: { railSide: RailSide; consoleSide: ConsoleSide },
  panel: "rail" | "console",
  side: DockSide,
): { railSide: RailSide; consoleSide: ConsoleSide } {
  if (!allowedSides(panel).includes(side)) return layout;
  return panel === "rail"
    ? { ...layout, railSide: side as RailSide }
    : { ...layout, consoleSide: side as ConsoleSide };
}

/** Where the zone sits on screen, as a fraction of the canvas it is drawn over. */
export function zoneBox(side: DockSide, edge = 0.14, thickness = 0.1) {
  switch (side) {
    case "top":
      return { left: 0, top: 0, width: 1, height: thickness };
    case "bottom":
      return { left: 0, top: 1 - thickness, width: 1, height: thickness };
    case "left":
      return { left: 0, top: edge, width: thickness, height: 1 - edge * 2 };
    case "right":
      return { left: 1 - thickness, top: edge, width: thickness, height: 1 - edge * 2 };
  }
}
