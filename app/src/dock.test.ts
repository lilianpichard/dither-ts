import { describe, expect, it } from "vitest";
import {
  DOCK_ZONES,
  allowedSides,
  dockLayout,
  dockSideForKey,
  resolveDockZone,
  zoneBox,
  type Point,
  type Rect,
} from "./dock";

const RECT: Rect = { left: 100, top: 50, width: 800, height: 600 };

function at(point: Point): string {
  return resolveDockZone(point, RECT);
}

describe("resolveDockZone", () => {
  it("picks the edge the pointer is nearest", () => {
    expect(at({ x: 110, y: 350 })).toBe("left");
    expect(at({ x: 890, y: 350 })).toBe("right");
    expect(at({ x: 500, y: 60 })).toBe("top");
    expect(at({ x: 500, y: 640 })).toBe("bottom");
  });

  it("resolves a corner by the dominant axis, not by neither", () => {
    // A drop near a corner still has to land somewhere.
    expect(at({ x: 120, y: 70 })).toBe("left");
    expect(at({ x: 880, y: 630 })).toBe("right");
  });

  it("resolves a drop dead centre without ambiguity", () => {
    // nx and ny are equal there, so the wide axis wins and the answer is stable.
    expect(at({ x: 500, y: 350 })).toBe("right");
  });

  it("treats a point outside the rectangle as its nearest edge", () => {
    // The pointer can leave the canvas while dragging; the answer must not flip.
    expect(at({ x: -500, y: 350 })).toBe("left");
    expect(at({ x: 5000, y: 350 })).toBe("right");
    expect(at({ x: 500, y: -500 })).toBe("top");
  });

  it("reads a rectangle that is not the one the pointer was captured in", () => {
    // The overlay can move between two frames, so the geometry is read fresh
    // and the caller gets the edge for the rectangle it is drawn over.
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    // Dead centre: the axes tie and the horizontal wins, which is the rule
    // above, so this pins the rule rather than a corner case.
    expect(resolveDockZone({ x: 50, y: 50 }, rect)).toBe("right");
    expect(resolveDockZone({ x: 20, y: 50 }, rect)).toBe("left");
    expect(resolveDockZone({ x: 50, y: 20 }, rect)).toBe("top");
    expect(resolveDockZone({ x: 50, y: 80 }, rect)).toBe("bottom");
  });
});

describe("allowedSides", () => {
  it("lets the rail sit on either side only", () => {
    expect([...allowedSides("rail")]).toEqual(["left", "right"]);
  });

  it("lets the console reach all four edges", () => {
    expect([...allowedSides("console")]).toEqual(["top", "right", "bottom", "left"]);
  });

  it("names every side exactly once in the zones", () => {
    expect(DOCK_ZONES.map((zone) => zone.side)).toEqual(["top", "right", "bottom", "left"]);
  });
});

describe("dockLayout", () => {
  const base = { railSide: "left" as const, consoleSide: "bottom" as const };

  it("moves the rail when the side is one it may take", () => {
    expect(dockLayout(base, "rail", "right").railSide).toBe("right");
  });

  it("refuses a rail that wants the top or the bottom", () => {
    // The rails run the full height, so a top or bottom rail is not a shape the
    // shell draws. Refusing keeps the answer assignable without a branch.
    expect(dockLayout(base, "rail", "top")).toEqual(base);
    expect(dockLayout(base, "rail", "bottom")).toEqual(base);
  });

  it("moves the console to any edge", () => {
    expect(dockLayout(base, "console", "right").consoleSide).toBe("right");
    expect(dockLayout(base, "console", "top").consoleSide).toBe("top");
    expect(dockLayout(base, "console", "left").consoleSide).toBe("left");
  });

  it("leaves the other panel alone", () => {
    const moved = dockLayout(base, "console", "top");
    expect(moved.railSide).toBe("left");
  });

  it("keeps the console on its own side when the rail moves", () => {
    const moved = dockLayout(base, "rail", "right");
    expect(moved.consoleSide).toBe("bottom");
  });
});

describe("dockSideForKey", () => {
  it("maps each arrow to the edge it points at", () => {
    expect(dockSideForKey("console", "ArrowUp")).toBe("top");
    expect(dockSideForKey("console", "ArrowRight")).toBe("right");
    expect(dockSideForKey("console", "ArrowDown")).toBe("bottom");
    expect(dockSideForKey("console", "ArrowLeft")).toBe("left");
  });

  it("refuses a vertical edge for the rail", () => {
    expect(dockSideForKey("rail", "ArrowLeft")).toBe("left");
    expect(dockSideForKey("rail", "ArrowRight")).toBe("right");
    expect(dockSideForKey("rail", "ArrowUp")).toBeNull();
    expect(dockSideForKey("rail", "ArrowDown")).toBeNull();
  });
});

describe("zoneBox", () => {
  it("frames each edge as a band that cannot cover the whole canvas", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const box = zoneBox(side);
      expect(box.width, side).toBeGreaterThan(0);
      expect(box.width, side).toBeLessThanOrEqual(1);
      expect(box.height, side).toBeGreaterThan(0);
      expect(box.height, side).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the left and right bands off the top and bottom edges", () => {
    // Otherwise they would swallow a drop aimed at the top or bottom band.
    expect(zoneBox("left").top).toBeGreaterThan(0);
    expect(zoneBox("right").top).toBeGreaterThan(0);
    expect(zoneBox("left").top + zoneBox("left").height).toBeLessThan(1);
    expect(zoneBox("right").top + zoneBox("right").height).toBeLessThan(1);
  });

  it("spans the full width for the top and bottom bands", () => {
    expect(zoneBox("top").width).toBe(1);
    expect(zoneBox("bottom").width).toBe(1);
  });
});
