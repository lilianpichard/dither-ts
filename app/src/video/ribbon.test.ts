import { describe, expect, it } from "vitest";
import { playheadPercent, spanPercent } from "./ribbon";

describe("spanPercent", () => {
  const DURATION = 10;

  it("maps a range to the band it covers, as fractions of the clip", () => {
    // A fraction rather than pixels, because the ribbon is drawn with a CSS
    // width and the clip length is not known until it is loaded.
    expect(spanPercent({ start: 2.5, end: 5 }, DURATION)).toEqual({
      left: 0.25,
      width: 0.25,
    });
  });

  it("covers the whole ribbon when the range is the whole clip", () => {
    expect(spanPercent({ start: 0, end: DURATION }, DURATION)).toEqual({ left: 0, width: 1 });
  });

  it("starts at the left edge and ends at the right edge", () => {
    // A span that reaches an edge has to touch it exactly, or the band looks
    // like it stops short of the clip it claims to bound.
    const whole = spanPercent({ start: 0, end: DURATION }, DURATION);
    expect(whole.left + whole.width).toBe(1);
  });

  it("draws nothing rather than a wrong band when the clip has no duration", () => {
    // A clip that has finished loading but reports zero seconds would divide by
    // zero and paint a band the width of the whole ribbon.
    expect(spanPercent({ start: 0, end: 0 }, 0)).toEqual({ left: 0, width: 0 });
  });

  it("clamps a range that runs past the end of the clip", () => {
    // The inputs are number fields, so the user can type 99 into a 10s clip.
    const span = spanPercent({ start: 8, end: 99 }, DURATION);
    expect(span.left + span.width).toBe(1);
    expect(span.width).toBeGreaterThan(0);
  });

  it("never draws an inverted band, even if start is past end", () => {
    // An inverted band has a negative width and renders as nothing, which reads
    // as "nothing is selected" rather than "everything is".
    const span = spanPercent({ start: 7, end: 3 }, DURATION);
    expect(span.width).toBeGreaterThanOrEqual(0);
    expect(span.left).toBeLessThanOrEqual(span.left + span.width);
  });

  it("keeps a zero-length range visible as a hairline rather than nothing", () => {
    // A single frame out of a clip is a real selection.
    const span = spanPercent({ start: 4, end: 4 }, DURATION);
    expect(span.left).toBeCloseTo(0.4);
    expect(span.width).toBe(0);
  });

  it("falls back to the whole clip when a field is empty", () => {
    // A cleared number input reads as NaN, and the same convention the range
    // clamp uses applies: a missing start is the head, a missing end the tail.
    expect(spanPercent({ start: 3, end: Number.NaN }, DURATION)).toEqual({ left: 0.3, width: 0.7 });
    expect(spanPercent({ start: Number.NaN, end: 3 }, DURATION)).toEqual({ left: 0, width: 0.3 });
  });
});

describe("playheadPercent", () => {
  it("puts the playhead where the frame is", () => {
    expect(playheadPercent(2.5, 10)).toBe(0.25);
  });

  it("stays inside the ribbon at both ends", () => {
    expect(playheadPercent(0, 10)).toBe(0);
    expect(playheadPercent(10, 10)).toBe(1);
  });

  it("clamps a time past the end, so the marker cannot escape the ribbon", () => {
    // Playback runs past the duration by a frame or two at the very end.
    expect(playheadPercent(12, 10)).toBe(1);
    expect(playheadPercent(-1, 10)).toBe(0);
  });

  it("parks at the start of a clip with no duration", () => {
    expect(playheadPercent(0, 0)).toBe(0);
    expect(playheadPercent(5, 0)).toBe(0);
  });

  it("parks at the start of a clip with no duration even for a negative time", () => {
    expect(playheadPercent(-5, 0)).toBe(0);
  });

  it("treats a non-finite time as the start", () => {
    expect(playheadPercent(Number.NaN, 10)).toBe(0);
  });
});
