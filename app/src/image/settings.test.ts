import { describe, expect, it } from "vitest";
import {
  ADJUSTMENTS,
  adjustmentValue,
  cropDraft,
  cropDraftKey,
  fitOperations,
  frameRect,
  isIdentity,
  nextQuarterTurn,
  operationsKey,
  requestOperations,
  sanitizeCrop,
  sanitizeOperations,
  scaleOperations,
} from "./settings";

describe("sanitizeOperations", () => {
  it("drops identity and unusable values so the worker cannot throw", () => {
    expect(
      sanitizeOperations({
        crop: { x: -1, y: 0, width: 4, height: 4 },
        rotate: 45,
        flipHorizontal: false,
        invert: "yes",
        brightness: Number.NaN,
        contrast: 2,
        hue: -400,
      }),
    ).toEqual({ contrast: 1, hue: -180 });
  });

  it("keeps a valid crop and turns in the declared order", () => {
    const clean = sanitizeOperations({
      invert: true,
      brightness: 0.25,
      rotate: 270,
      crop: { width: 8, height: 6, x: 2, y: 4 },
    });
    expect(Object.keys(clean)).toEqual(["crop", "rotate", "brightness", "invert"]);
    expect(clean.crop).toEqual({ x: 2, y: 4, width: 8, height: 6 });
  });

  it("rejects non-object input", () => {
    expect(sanitizeOperations(null)).toEqual({});
    expect(sanitizeOperations([1, 2])).toEqual({});
    expect(sanitizeOperations("invert")).toEqual({});
  });
});

describe("sanitizeCrop", () => {
  it("requires whole pixels inside the frame origin", () => {
    expect(sanitizeCrop({ x: 1.5, y: 0, width: 2, height: 2 })).toBeUndefined();
    expect(sanitizeCrop({ x: 0, y: 0, width: 0, height: 2 })).toBeUndefined();
    expect(sanitizeCrop({ x: 0, y: 0, width: 2, height: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    });
  });
});

describe("fitOperations", () => {
  it("clamps a crop to the frame it is applied to", () => {
    const crop = { x: 30, y: 28, width: 200, height: 200 };
    expect(fitOperations({ crop }, 32, 32).crop).toEqual({ x: 30, y: 28, width: 2, height: 4 });
  });

  it("drops the crop when the frame size is unusable", () => {
    expect(
      fitOperations({ crop: { x: 0, y: 0, width: 4, height: 4 }, invert: true }, 0, 0),
    ).toEqual({
      invert: true,
    });
  });
});

describe("scaleOperations", () => {
  it("rescales a source-space crop onto a downscaled preview", () => {
    const scaled = scaleOperations(
      { crop: { x: 10, y: 20, width: 40, height: 40 }, saturation: -0.5 },
      0.5,
    );
    expect(scaled.crop).toEqual({ x: 5, y: 10, width: 20, height: 20 });
    expect(scaled.saturation).toBe(-0.5);
  });

  it("keeps at least one pixel and drops the crop for a bad factor", () => {
    expect(scaleOperations({ crop: { x: 0, y: 0, width: 1, height: 1 } }, 0.01).crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    expect(scaleOperations({ crop: { x: 0, y: 0, width: 4, height: 4 } }, 0).crop).toBeUndefined();
  });
});

describe("operationsKey", () => {
  it("ignores key order and identity noise", () => {
    expect(operationsKey({ invert: true, brightness: 0.5 })).toBe(
      operationsKey({ brightness: 0.5, invert: true }),
    );
    expect(operationsKey({ brightness: 0, rotate: 0, invert: false })).toBe("{}");
    expect(operationsKey({ brightness: 0.5 })).not.toBe(operationsKey({ brightness: 0.6 }));
  });

  it("survives a structured-clone round trip", () => {
    const original = { crop: { x: 1, y: 2, width: 3, height: 4 }, rotate: 90, hue: -30 };
    expect(operationsKey(structuredClone(original))).toBe(operationsKey(original));
  });
});

describe("identity", () => {
  it("recognises an empty operation set", () => {
    expect(isIdentity({})).toBe(true);
    expect(isIdentity({ brightness: 0, rotate: 0, flipVertical: false })).toBe(true);
    expect(isIdentity({ invert: true })).toBe(false);
  });
});

describe("requestOperations", () => {
  it("omits identity and clamps the rest to the target frame", () => {
    expect(requestOperations({}, 64, 64)).toBeUndefined();
    expect(requestOperations({ brightness: 0, invert: false }, 64, 64)).toBeUndefined();
    expect(requestOperations({ crop: { x: 60, y: 60, width: 40, height: 40 } }, 64, 64)).toEqual({
      crop: { x: 60, y: 60, width: 4, height: 4 },
    });
  });
});

describe("crop drafts", () => {
  it("shows the whole frame when nothing is cropped", () => {
    expect(cropDraft(undefined, 40, 30)).toEqual({ x: 0, y: 0, width: 40, height: 30 });
    expect(frameRect(0, 0)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("shows the applied crop when there is one", () => {
    const crop = { x: 2, y: 3, width: 4, height: 5 };
    expect(cropDraft(crop, 40, 30)).toEqual(crop);
  });

  it("resyncs when the frame changes as well as when the crop does", () => {
    const crop = { x: 0, y: 0, width: 8, height: 8 };
    const base = cropDraftKey(40, 30, crop);
    expect(cropDraftKey(80, 60, crop)).not.toBe(base);
    expect(cropDraftKey(40, 30, { x: 0, y: 0, width: 9, height: 8 })).not.toBe(base);
    expect(cropDraftKey(40, 30, crop)).toBe(base);
    // The same crop values over a bigger frame still resync the draft.
    expect(cropDraftKey(40, 30, undefined)).not.toBe(cropDraftKey(41, 30, undefined));
  });
});

describe("adjustment values", () => {
  it("covers the four colour adjustments and falls back to zero", () => {
    expect(ADJUSTMENTS.map((a) => a.key)).toEqual(["brightness", "contrast", "saturation", "hue"]);
    for (const def of ADJUSTMENTS) {
      expect(adjustmentValue({ [def.key]: 0.5 }, def.key)).toBe(0.5);
      expect(adjustmentValue({}, def.key)).toBe(0);
    }
  });
});

describe("nextQuarterTurn", () => {
  it("cycles clockwise and returns to 0", () => {
    expect(nextQuarterTurn(0)).toBe(90);
    expect(nextQuarterTurn(90)).toBe(180);
    expect(nextQuarterTurn(180)).toBe(270);
    expect(nextQuarterTurn(270)).toBe(0);
    expect(nextQuarterTurn(undefined)).toBe(90);
  });
});
