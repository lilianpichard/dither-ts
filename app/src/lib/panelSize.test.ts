import { describe, expect, it } from "vitest";
import { panelMaxExtent, parsePanelSize } from "./panelSize";

describe("parsePanelSize", () => {
  it("keeps a collapsed panel collapsed across a reload", () => {
    expect(parsePanelSize("0", 300)).toBe(0);
  });

  it("accepts a normal stored size", () => {
    expect(parsePanelSize("420", 300)).toBe(420);
  });

  it("falls back for missing, invalid, or negative values", () => {
    expect(parsePanelSize(null, 300)).toBe(300);
    expect(parsePanelSize("not a number", 300)).toBe(300);
    expect(parsePanelSize("-1", 300)).toBe(300);
  });
});

describe("panelMaxExtent", () => {
  const bounds = { w: 1200, h: 800 };

  it("measures a side panel on width and a top or bottom panel on height", () => {
    expect(panelMaxExtent(bounds, "left", 0, 400)).toBe(800);
    expect(panelMaxExtent(bounds, "right", 0, 400)).toBe(800);
    expect(panelMaxExtent(bounds, "top", 0, 300)).toBe(500);
    expect(panelMaxExtent(bounds, "bottom", 0, 300)).toBe(500);
  });

  it("leaves room for the neighbouring panel", () => {
    expect(panelMaxExtent(bounds, "right", 200, 400)).toBe(600);
  });

  it("never returns a negative extent", () => {
    expect(panelMaxExtent({ w: 500, h: 500 }, "left", 0, 600)).toBe(0);
  });
});
