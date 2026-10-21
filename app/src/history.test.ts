import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  commitHistory,
  redoHistory,
  undoHistory,
  type HistoryEntry,
  type HistoryState,
} from "./history";
import type { DitherParams } from "./store";
import type { RGB } from "../../src/index.js";

const hasPast = (h: HistoryState) => h.past.length > 0;
const hasFuture = (h: HistoryState) => h.future.length > 0;
const baseParams: DitherParams = {
  method: "Floyd-Steinberg",
  threshold: 128,
  palette: "B&W",
  color: false,
  pixelSize: 1,
};

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { params: { ...baseParams }, operations: {}, effects: [], ...overrides };
}

describe("commitHistory", () => {
  it("ignores a change that alters nothing", () => {
    const history = commitHistory(EMPTY_HISTORY, entry(), entry());
    expect(history).toBe(EMPTY_HISTORY);
    expect(hasPast(history)).toBe(false);
  });

  it("records the replaced state and clears the redo branch", () => {
    const withPast = commitHistory(
      EMPTY_HISTORY,
      entry(),
      entry({ params: { ...baseParams, threshold: 90 } }),
    );
    const undone = undoHistory(withPast, entry({ params: { ...baseParams, threshold: 90 } }));
    expect(hasFuture(undone.history)).toBe(true);

    const branched = commitHistory(
      undone.history,
      entry({ params: { ...baseParams, threshold: 90 } }),
      entry({ params: { ...baseParams, color: true } }),
    );
    expect(branched.future).toEqual([]);
    expect(branched.past).toHaveLength(1);
  });

  it("coalesces a slider drag into one entry", () => {
    let history = EMPTY_HISTORY;
    let current = entry();
    for (const threshold of [100, 110, 120, 130]) {
      const next = entry({ params: { ...baseParams, threshold } });
      history = commitHistory(history, current, next);
      current = next;
    }
    expect(history.past).toHaveLength(1);
    expect(history.past[0].params.threshold).toBe(128);

    const step = undoHistory(history, current);
    expect(step.entry?.params.threshold).toBe(128);
  });

  it("splits a drag when another control changes in between", () => {
    let history = EMPTY_HISTORY;
    let current = entry();
    for (const next of [
      entry({ params: { ...baseParams, threshold: 100 } }),
      entry({ params: { ...baseParams, threshold: 110 } }),
      entry({ params: { ...baseParams, threshold: 110, color: true } }),
      entry({ params: { ...baseParams, threshold: 120, color: true } }),
    ]) {
      history = commitHistory(history, current, next);
      current = next;
    }
    expect(history.past.map((e) => e.params.threshold)).toEqual([128, 110, 110]);
  });

  it("keeps one entry per discrete toggle", () => {
    const states = [
      entry({ operations: { invert: true } }),
      entry({ operations: { invert: true, rotate: 90 } }),
      entry({ operations: { invert: true, rotate: 90, brightness: 0.5 } }),
    ];
    let history = EMPTY_HISTORY;
    let current = entry();
    for (const next of states) {
      history = commitHistory(history, current, next);
      current = next;
    }
    expect(history.past.map((e) => Object.keys(e.operations))).toEqual([
      [],
      ["invert"],
      ["rotate", "invert"],
    ]);
  });

  it("records a colour-mode-only change", () => {
    const start = entry({ params: { ...baseParams, color: true } });
    const next = entry({ params: { ...baseParams, color: true, colorMode: "original" } });
    const history = commitHistory(EMPTY_HISTORY, start, next);
    expect(history.past).toHaveLength(1);
  });

  it("records effect edits and coalesces a parameter drag", () => {
    const effect = (radius: number) => ({
      key: "fx-1",
      type: "blur",
      params: { radius },
      enabled: true,
    });
    let history = EMPTY_HISTORY;
    let current = entry();
    const added = entry({ effects: [effect(2)] });
    history = commitHistory(history, current, added);
    current = added;
    expect(history.past).toHaveLength(1);

    const moved = entry({ effects: [effect(4)] });
    history = commitHistory(history, current, moved);
    current = moved;
    expect(history.past).toHaveLength(2);

    const movedAgain = entry({ effects: [effect(6)] });
    history = commitHistory(history, current, movedAgain);
    expect(history.past).toHaveLength(2);
  });

  it("caps the stack at the documented limit", () => {
    let history = EMPTY_HISTORY;
    let current = entry();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const next = entry({ operations: { invert: i % 2 === 0 } });
      history = commitHistory(history, current, next);
      current = next;
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("undo and redo", () => {
  it("walks params and operations back and forward again", () => {
    const start = entry();
    const middle = entry({ params: { ...baseParams, threshold: 200 } });
    const end = entry({
      params: { ...baseParams, threshold: 200 },
      operations: { invert: true, hue: -45 },
    });
    const history = commitHistory(commitHistory(EMPTY_HISTORY, start, middle), middle, end);

    const first = undoHistory(history, end);
    expect(first.entry?.params.threshold).toBe(200);
    expect(first.entry?.operations).toEqual({});
    expect(hasPast(first.history)).toBe(true);
    expect(hasFuture(first.history)).toBe(true);

    const second = undoHistory(first.history, first.entry!);
    expect(second.entry?.params.threshold).toBe(128);
    expect(hasPast(second.history)).toBe(false);

    const forward = redoHistory(second.history, second.entry!);
    expect(forward.entry?.params.threshold).toBe(200);
    const again = redoHistory(forward.history, forward.entry!);
    expect(again.entry?.operations).toEqual({ invert: true, hue: -45 });
    expect(hasFuture(again.history)).toBe(false);
  });

  it("walks the effect stack back and forward too", () => {
    const start = entry();
    const withEffect = entry({
      effects: [{ key: "fx-1", type: "blur", params: { radius: 2 }, enabled: true }],
    });
    const history = commitHistory(EMPTY_HISTORY, start, withEffect);
    const step = undoHistory(history, withEffect);
    expect(step.entry?.effects).toEqual([]);
    const forward = redoHistory(step.history, step.entry!);
    expect(forward.entry?.effects).toEqual(withEffect.effects);
  });

  it("reports a no-op at both ends of the stack", () => {
    const current = entry();
    const undone = undoHistory(EMPTY_HISTORY, current);
    expect(undone.entry).toBeNull();
    expect(undone.history).toBe(EMPTY_HISTORY);
    expect(redoHistory(EMPTY_HISTORY, current).entry).toBeNull();
  });

  it("hands out copies so callers cannot corrupt the stack", () => {
    const start = entry();
    const next = entry({ params: { ...baseParams, color: true } });
    const history = commitHistory(EMPTY_HISTORY, start, next);
    const step = undoHistory(history, next);
    expect(step.entry).not.toBe(history.past[0]);
    if (!step.entry) throw new Error("expected an undo step");
    step.entry.params.threshold = 5;
    expect(history.past[0].params.threshold).toBe(128);
  });

  it("copies custom palettes in both directions", () => {
    const colors: RGB[] = [
      [1, 2, 3],
      [250, 251, 252],
    ];
    const start = entry({ params: { ...baseParams, color: true, palette: colors } });
    const next = entry({
      params: { ...baseParams, color: true, palette: [...colors], threshold: 90 },
    });
    const history = commitHistory(EMPTY_HISTORY, start, next);
    const snapshot = history.past[0].params.palette as RGB[];

    expect(snapshot).not.toBe(colors);
    expect(snapshot[0]).not.toBe(colors[0]);
    colors[0][0] = 99;
    expect(snapshot).toEqual([
      [1, 2, 3],
      [250, 251, 252],
    ]);

    snapshot[1][2] = 7;
    expect(colors[1][2]).toBe(252);
  });
});
