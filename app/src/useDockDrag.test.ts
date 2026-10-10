import { describe, expect, it } from "vitest";
import { DOCK_REACH, hasMoved } from "./useDockDrag";

describe("hasMoved", () => {
  it("is false for a press that stayed where it was", () => {
    // A click on the handle must not re-dock the panel.
    expect(hasMoved({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    expect(hasMoved({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
  });

  it("is true once the press passes the reach in either axis", () => {
    expect(hasMoved({ x: 10, y: 10 }, { x: 10 + DOCK_REACH + 1, y: 10 })).toBe(true);
    expect(hasMoved({ x: 10, y: 10 }, { x: 10, y: 10 + DOCK_REACH + 1 })).toBe(true);
  });

  it("is false exactly at the reach, so the boundary is not off by one", () => {
    expect(hasMoved({ x: 10, y: 10 }, { x: 10 + DOCK_REACH, y: 10 })).toBe(false);
    expect(hasMoved({ x: 10, y: 10 }, { x: 10, y: 10 + DOCK_REACH })).toBe(false);
  });

  it("is asymmetric, so dragging back over the handle still counts", () => {
    expect(hasMoved({ x: 10, y: 10 }, { x: 10 - DOCK_REACH - 1, y: 10 })).toBe(true);
  });
});
