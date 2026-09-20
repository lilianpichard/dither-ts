import { describe, expect, it } from "vitest";
import { parsePresetJson, serializePreset, type Preset } from "./schema";

const VALID = JSON.stringify({
  version: 1,
  name: "Retro",
  params: { method: "Stucki", threshold: 150, palette: "GameBoy", color: true, pixelSize: 2 },
  effects: [{ type: "glow", params: { radius: 4, intensity: 30 }, enabled: true }],
});

describe("preset schema", () => {
  it("round-trips a valid preset without warnings", () => {
    const { preset, warnings } = parsePresetJson(VALID);
    expect(warnings).toEqual([]);
    expect(preset).not.toBeNull();
    expect(JSON.parse(serializePreset(preset!))).toEqual(JSON.parse(VALID));
  });

  it("rejects non-JSON and non-objects safely", () => {
    expect(parsePresetJson("{oops").preset).toBeNull();
    expect(parsePresetJson("[1,2]").preset).toBeNull();
    expect(parsePresetJson("42").warnings.length).toBeGreaterThan(0);
  });

  it("fills defaults with warnings for garbage input", () => {
    const { preset, warnings } = parsePresetJson("{}");
    expect(preset).not.toBeNull();
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.name).toBe("Untitled");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("falls back per-field with warnings", () => {
    const { preset, warnings } = parsePresetJson(
      JSON.stringify({
        name: "X",
        params: { method: "Nope", threshold: 999, palette: "Nope", color: "yes", pixelSize: 99 },
        effects: [
          { nope: true },
          { type: "", params: null },
          { type: "blur", params: { r: 2, bad: "x" } },
        ],
      }),
    );
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.params.palette).toBe("B&W");
    expect(preset!.params.color).toBe(false);
    expect(preset!.params.pixelSize).toBe(1);
    expect(preset!.effects).toEqual([{ type: "blur", params: { r: 2 }, enabled: true }]);
    expect(warnings.length).toBeGreaterThan(3);
  });

  it("accepts a valid custom palette and rejects a bad one", () => {
    const good: Preset = {
      version: 1,
      name: "C",
      params: {
        method: "Bayer 4x4",
        threshold: 128,
        palette: {
          custom: [
            [0, 0, 0],
            [255, 0, 0],
          ],
        },
        color: true,
        pixelSize: 1,
      },
      effects: [],
    };
    const back = parsePresetJson(serializePreset(good));
    expect(back.warnings).toEqual([]);
    expect(back.preset!.params.palette).toEqual({
      custom: [
        [0, 0, 0],
        [255, 0, 0],
      ],
    });

    const bad = parsePresetJson(JSON.stringify({ params: { palette: { custom: [[300, 0, 0]] } } }));
    expect(bad.preset!.params.palette).toBe("B&W");
  });

  it("ignores unknown fields", () => {
    const { preset, warnings } = parsePresetJson(
      JSON.stringify({ future: true, params: { method: "Atkinson", extra: 1 } }),
    );
    expect(preset!.params.method).toBe("Atkinson");
    expect("future" in preset!).toBe(false);
    expect("extra" in (preset!.params as object)).toBe(false);
    expect(warnings.length).toBeGreaterThan(0); // other defaults still warn
  });
});
