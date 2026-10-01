import { beforeEach, describe, expect, it } from "vitest";
import { applyEffects, defaultEffectParams } from "../../../src/index.js";
import { applyPreset, paramsToPreset, presetToParams } from "./store";
import { parsePresetJson, serializePreset, type Preset } from "./schema";
import { PRESET_VERSION } from "./version";
import { useApp, resolveColorMode, type DitherParams } from "../store";

const params: DitherParams = {
  method: "Floyd-Steinberg",
  threshold: 128,
  palette: "GameBoy",
  color: false,
  pixelSize: 1,
};

function preset(overrides: Partial<Preset> = {}): Preset {
  return {
    version: PRESET_VERSION,
    name: "Plain",
    params: {
      method: "Bayer 4x4",
      threshold: 64,
      palette: "GameBoy",
      color: false,
      pixelSize: 2,
    },
    effects: [],
    ...overrides,
  };
}

beforeEach(() => {
  const current = useApp.getState();
  useApp.setState({
    params: { ...current.params },
    effects: [],
    operations: {},
    past: [],
    future: [],
  });
});

describe("applying a preset", () => {
  it("replaces operations instead of merging them", () => {
    useApp.getState().setOperations({ invert: true, hue: 45, rotate: 90 });
    applyPreset(preset({ operations: { brightness: 0.25 } }));

    expect(useApp.getState().operations).toEqual({ brightness: 0.25 });
  });

  it("clears operations when the preset has none", () => {
    useApp.getState().setOperations({ crop: { x: 1, y: 2, width: 8, height: 8 }, invert: true });
    applyPreset(preset());

    expect(useApp.getState().operations).toEqual({});
  });

  it("replaces params and the effect stack in one step", () => {
    useApp.getState().setParams({ threshold: 200 });
    useApp.getState().addEffect("blur");
    applyPreset(preset({ effects: [{ type: "glow", params: { radius: 2 }, enabled: false }] }));

    const state = useApp.getState();
    expect(state.params.threshold).toBe(64);
    expect(state.params.pixelSize).toBe(2);
    expect(state.effects).toEqual([
      { key: expect.any(String), type: "glow", params: { radius: 2 }, enabled: false },
    ]);
  });

  it("is undoable as a single step", () => {
    useApp.getState().setParams({ threshold: 200 });
    useApp.getState().setOperations({ invert: true });
    useApp.getState().setParams({ threshold: 64 }, { brightness: 0.5 });

    useApp.getState().undo();
    expect(useApp.getState().params.threshold).toBe(200);
    expect(useApp.getState().operations).toEqual({ invert: true });
  });
});

describe("preset conversion", () => {
  it("keeps operations through a preset round trip", () => {
    const operations = { crop: { x: 2, y: 4, width: 32, height: 16 }, rotate: 90 as const };
    const saved = paramsToPreset("Ops", params, [], operations);

    expect(saved.operations).toEqual(operations);
    expect(presetToParams(saved)).toEqual(params);
  });

  it("defaults to identity operations", () => {
    expect(paramsToPreset("None", params, []).operations).toEqual({});
  });

  it("stamps the shared version constant, not a literal", () => {
    expect(paramsToPreset("V", params, []).version).toBe(PRESET_VERSION);
  });

  it("keeps the colour mode through a save and an apply", () => {
    // The schema understood colorMode the whole time, so a preset set to
    // Original and applied again used to come back as Palette.
    const original = { ...params, color: true, colorMode: "original" as const };
    const saved = paramsToPreset("Original", original, []);
    expect(saved.params.colorMode).toBe("original");
    expect(presetToParams(saved).colorMode).toBe("original");
    expect(resolveColorMode(presetToParams(saved))).toBe("original");
  });

  it("leaves the field out when the preset never had one", () => {
    // A preset written before colorMode existed means palette, and must not
    // gain an explicit value on the way through.
    const saved = paramsToPreset("Legacy", params, []);
    expect("colorMode" in saved.params).toBe(false);
    expect("colorMode" in presetToParams(saved)).toBe(false);
    expect(resolveColorMode(presetToParams(saved))).toBe("palette");
  });

  it("reads back through the parser without warnings", () => {
    const effects = [{ type: "glow", params: { radius: 4, intensity: 30 }, enabled: true }];
    const saved = paramsToPreset("Round", params, effects);
    const back = parsePresetJson(serializePreset(saved));
    expect(back.warnings).toEqual([]);
    // Identity operations are deliberately kept out of the file, so that one
    // key is the only thing not carried back.
    expect(back.preset).toEqual({ ...saved, operations: undefined });
    expect("operations" in back.preset!).toBe(false);
  });

  it("keeps an effect stack the kernel would accept", () => {
    const effects = [
      { type: "glow", params: defaultEffectParams("glow"), enabled: true },
      { type: "sharpen", params: { amount: 2 }, enabled: false },
    ];
    const saved = paramsToPreset("Stack", params, effects);
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    expect(() => applyEffects(pixels, 4, 4, saved.effects)).not.toThrow();
    // Every param is declared, so the parser has nothing to complete or correct.
    expect(parsePresetJson(serializePreset(saved)).warnings).toEqual([]);
  });
});
