import { describe, expect, it } from "vitest";
import {
  advancePlayback,
  clampTime,
  jumpTime,
  previewDue,
  shouldRenderLive,
  stepTime,
  targetMoved,
  transportStatus,
} from "./transport";
import { createIntl } from "react-intl";
import { MESSAGES, type Locale } from "../i18n/messages";
import type { Translate } from "../i18n";

/** A real `t`, so the ICU number formatting the messages rely on runs too. */
function tFor(locale: Locale): Translate {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  return ((id: string, values?: Record<string, string | number>) =>
    String(intl.formatMessage({ id }, values))) as unknown as Translate;
}

const t = tFor("en");

const FULL = { playing: true, time: 1.234, duration: 4, loop: false };

describe("transport time clamping", () => {
  it("keeps a time inside the clip", () => {
    expect(clampTime(1.5, 4)).toBe(1.5);
    expect(clampTime(-3, 4)).toBe(0);
    expect(clampTime(9, 4)).toBe(4);
  });

  it("falls back to zero for unusable input", () => {
    expect(clampTime(Number.NaN, 4)).toBe(0);
    expect(clampTime(2, 0)).toBe(0);
    expect(clampTime(2, Number.NaN)).toBe(0);
    expect(clampTime(2, -5)).toBe(0);
  });
});

describe("frame stepping", () => {
  it("steps one frame in each direction", () => {
    expect(stepTime(1, 1, 0.25, 4)).toBe(1.25);
    expect(stepTime(1, -1, 0.25, 4)).toBe(0.75);
  });

  it("clamps at both ends instead of wrapping", () => {
    expect(stepTime(3.9, 1, 0.25, 4)).toBe(4);
    expect(stepTime(0.1, -1, 0.25, 4)).toBe(0);
  });

  it("holds position for a degenerate step", () => {
    expect(stepTime(1, 1, 0, 4)).toBe(1);
    expect(stepTime(1, 1, Number.NaN, 4)).toBe(1);
    expect(stepTime(1, -1, 1e-9, 4)).toBe(1);
  });
});

describe("jumping to the clip edges", () => {
  it("jumps to the first and last frame", () => {
    expect(jumpTime(-1, 4)).toBe(0);
    expect(jumpTime(1, 4)).toBe(4);
  });

  it("lands at zero for an unknown duration", () => {
    expect(jumpTime(1, 0)).toBe(0);
    expect(jumpTime(1, Number.NaN)).toBe(0);
  });
});

describe("looping past the end", () => {
  it("wraps to the head when looping", () => {
    expect(advancePlayback(4, 4, true)).toEqual({ time: 0, wrapped: true, finished: false });
  });

  it("finishes at the end when not looping, reporting the end as the time", () => {
    // The old shape left the readout a frame short of the end on a natural stop.
    expect(advancePlayback(4, 4, false)).toEqual({
      time: 4,
      wrapped: false,
      finished: true,
    });
  });

  it("leaves a playhead that is not finished alone", () => {
    expect(advancePlayback(2, 4, true)).toEqual({ time: 2, wrapped: false, finished: false });
    expect(advancePlayback(2, 4, false)).toEqual({ time: 2, wrapped: false, finished: false });
  });

  it("treats a playhead inside the end epsilon as finished", () => {
    // A last-frame step lands a hair short of duration, which is still the end.
    expect(advancePlayback(3.9995, 4, false).finished).toBe(true);
    expect(advancePlayback(3.99, 4, false).finished).toBe(false);
    expect(advancePlayback(3.9995, 4, true).wrapped).toBe(true);
  });

  it("never finishes or wraps on an empty clip", () => {
    for (const duration of [0, Number.NaN]) {
      expect(advancePlayback(0, duration, false)).toEqual({
        time: 0,
        wrapped: false,
        finished: false,
      });
      expect(advancePlayback(0, duration, true)).toEqual({
        time: 0,
        wrapped: false,
        finished: false,
      });
    }
  });

  it("clamps a playhead that overshot the clip", () => {
    expect(advancePlayback(9, 4, false)).toEqual({ time: 4, wrapped: false, finished: true });
    expect(advancePlayback(9, 4, true)).toEqual({ time: 0, wrapped: true, finished: false });
  });
});

describe("transport status line", () => {
  it("reports playing state with both times", () => {
    expect(transportStatus(FULL, t)).toBe("Playing 1.23s of 4.00s");
  });

  it("mentions looping only while it is on", () => {
    expect(transportStatus({ ...FULL, loop: true }, t)).toContain("looping");
    expect(transportStatus({ ...FULL, playing: false }, t)).not.toContain("looping");
  });

  it("distinguishes paused from stopped at the end", () => {
    expect(transportStatus({ ...FULL, playing: false }, t)).toBe("Paused at 1.23s of 4.00s");
    expect(transportStatus({ ...FULL, playing: false, time: 4 }, t)).toContain("at the end");
  });

  it("says so when there is nothing loaded", () => {
    expect(transportStatus({ playing: false, time: 0, duration: 0, loop: false }, t)).toBe(
      "No video loaded",
    );
  });
});

describe("preview throttling", () => {
  it("always refreshes when paused", () => {
    expect(previewDue({ playing: false, lastAt: 1_000, now: 1_001 })).toBe(true);
  });

  it("always refreshes the first frame of a playback", () => {
    expect(previewDue({ playing: true, lastAt: null, now: 0 })).toBe(true);
  });

  it("holds off until the interval has passed", () => {
    expect(previewDue({ playing: true, lastAt: 1_000, now: 1_050 })).toBe(false);
    expect(previewDue({ playing: true, lastAt: 1_000, now: 1_200 })).toBe(true);
  });

  it("honours a custom interval and rejects a bad clock", () => {
    expect(previewDue({ playing: true, lastAt: 0, now: 10, intervalMs: 10 })).toBe(true);
    expect(previewDue({ playing: true, lastAt: 0, now: Number.NaN })).toBe(false);
  });
});

describe("coalesced preview targets", () => {
  it("wants a render when nothing has been shown yet", () => {
    expect(targetMoved(null, 1)).toBe(true);
  });

  it("wants a render once the playhead has moved", () => {
    expect(targetMoved(1, 1.5)).toBe(true);
    expect(targetMoved(1.5, 1)).toBe(true);
  });

  it("does not spend a render on a playhead that has not moved", () => {
    expect(targetMoved(1, 1)).toBe(false);
    expect(targetMoved(1, 1.001)).toBe(false);
  });

  it("rejects an unusable target instead of rendering garbage", () => {
    expect(targetMoved(1, null)).toBe(false);
    expect(targetMoved(1, Number.NaN)).toBe(false);
  });

  it("honours a custom movement epsilon", () => {
    expect(targetMoved(1, 1.05, 0.1)).toBe(false);
    expect(targetMoved(1, 1.05, 0.01)).toBe(true);
  });
});

describe("coalesced live preview gate", () => {
  const READY = {
    playing: true,
    inFlight: false,
    lastAt: 1_000,
    now: 2_000,
    shown: 1,
    target: 2,
  };

  it("starts a render when one is due and the playhead moved", () => {
    expect(shouldRenderLive(READY)).toBe(true);
  });

  it("never starts a second render while one is in flight", () => {
    // The cancel-and-respawn loop is what starved slow methods.
    expect(shouldRenderLive({ ...READY, inFlight: true })).toBe(false);
  });

  it("does not render while paused", () => {
    expect(shouldRenderLive({ ...READY, playing: false })).toBe(false);
  });

  it("holds off until the cadence floor has passed", () => {
    expect(shouldRenderLive({ ...READY, now: 1_050 })).toBe(false);
  });

  it("chains a slow render straight on to the newest target", () => {
    // A render that took longer than the floor leaves a fresh one due at once.
    const slow = { ...READY, lastAt: 1_000, now: 4_000, shown: 1, target: 3.9 };
    expect(shouldRenderLive(slow)).toBe(true);
  });

  it("skips a target the canvas already shows", () => {
    expect(shouldRenderLive({ ...READY, target: 1 })).toBe(false);
    expect(shouldRenderLive({ ...READY, target: null })).toBe(false);
  });

  it("renders the very first frame of a run", () => {
    expect(shouldRenderLive({ ...READY, lastAt: null, shown: null, target: 0.5 })).toBe(true);
  });
});
