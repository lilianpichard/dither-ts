import { describe, expect, it } from "vitest";
import {
  applyEffects,
  defaultEffectParams,
  ditherRGBA,
  EFFECT_DEFS,
  PALETTES,
} from "../../../src/index.js";
import type { RGBAImage } from "../../../src/index.js";
import { parsePresetJson, serializePreset, type Preset } from "./schema";
import { presetToParams } from "./store";
import { PRESET_VERSION } from "./version";

const VALID = JSON.stringify({
  version: 1,
  name: "Retro",
  params: { method: "Stucki", threshold: 150, palette: "GameBoy", color: true, pixelSize: 2 },
  effects: [{ type: "glow", params: { radius: 4, intensity: 30 }, enabled: true }],
});

describe("preset schema", () => {
  it("keeps a pixel size the rail can produce", () => {
    const body = JSON.parse(VALID) as { params: { pixelSize: number } };
    body.params.pixelSize = 32;
    const { preset, warnings } = parsePresetJson(JSON.stringify(body));
    expect(warnings).toEqual([]);
    expect(preset!.params.pixelSize).toBe(32);
  });

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
        params: { method: "Nope", threshold: 999, palette: "Nope", color: "yes", pixelSize: 999 },
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
    // `r` and `bad` are not blur params, so blur keeps its declared default.
    expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
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

describe("colorMode", () => {
  const base = {
    version: PRESET_VERSION,
    name: "Mode",
    params: {
      method: "Bayer 4x4",
      threshold: 128,
      palette: "Gruvbox",
      color: true,
      pixelSize: 4,
    },
    effects: [],
  } as Preset;

  it("round-trips an explicit original mode", () => {
    const back = parsePresetJson(
      serializePreset({ ...base, params: { ...base.params, colorMode: "original" } }),
    );
    expect(back.warnings).toEqual([]);
    expect(back.preset!.params.colorMode).toBe("original");
  });

  it("leaves colorMode absent when the preset never chose one", () => {
    const back = parsePresetJson(serializePreset(base));
    expect(back.warnings).toEqual([]);
    expect(back.preset!.params.colorMode).toBeUndefined();
    // Absent must not be written out as an explicit "palette".
    expect(serializePreset(base)).not.toContain("colorMode");
  });

  it("warns and falls back to palette on an unknown mode", () => {
    const text = JSON.stringify({ ...base, params: { ...base.params, colorMode: "rainbow" } });
    const back = parsePresetJson(text);
    expect(back.preset!.params.colorMode).toBeUndefined();
    expect(back.warnings.join(" ")).toContain("colorMode");
  });
});

describe("effect type validation", () => {
  // Params are complete so every warning below comes from the effects array.
  const withEffects = (effects: unknown[]): ReturnType<typeof parsePresetJson> =>
    parsePresetJson(
      JSON.stringify({
        version: 1,
        name: "E",
        params: { method: "Bayer 4x4", threshold: 128, palette: "GameBoy", pixelSize: 1 },
        effects,
      }),
    );

  it("accepts every effect type the kernel registers", () => {
    const types = EFFECT_DEFS.map((def) => def.type);
    expect(types.length).toBeGreaterThan(0);
    const { preset, warnings } = withEffects(types.map((type) => ({ type, params: {} })));
    expect(warnings).toEqual([]);
    expect(preset!.effects.map((e) => e.type)).toEqual(types);
  });

  it("drops an unregistered type, which the worker would throw on", () => {
    const { preset, warnings } = withEffects([{ type: "nope", params: {} }]);
    expect(preset!.effects).toEqual([]);
    expect(warnings).toEqual(['unknown effect type "nope" at index 0, dropping']);
  });

  it("names the index so a drop points at the culprit", () => {
    const { preset, warnings } = withEffects([
      { type: "blur", params: { radius: 1 } },
      { type: "ghost", params: {} },
      { type: "also-ghost", params: {} },
    ]);
    expect(preset!.effects.map((e) => e.type)).toEqual(["blur"]);
    expect(warnings).toEqual([
      'unknown effect type "ghost" at index 1, dropping',
      'unknown effect type "also-ghost" at index 2, dropping',
    ]);
  });

  it("rejects a type of the wrong shape", () => {
    for (const type of [7, null, "", {}, ["blur"]]) {
      const { preset, warnings } = withEffects([{ type, params: {} }]);
      expect(preset!.effects).toEqual([]);
      expect(warnings).toEqual(["dropping invalid effect at index 0"]);
    }
  });

  it("is case sensitive about effect types", () => {
    const { preset, warnings } = withEffects([{ type: "Blur", params: {} }]);
    expect(preset!.effects).toEqual([]);
    expect(warnings).toEqual(['unknown effect type "Blur" at index 0, dropping']);
  });
});

describe("effect param validation", () => {
  // Params are complete so every warning below comes from the effects array.
  const withEffects = (effects: unknown[]): ReturnType<typeof parsePresetJson> =>
    parsePresetJson(
      JSON.stringify({
        version: 1,
        name: "E",
        params: { method: "Bayer 4x4", threshold: 128, palette: "GameBoy", pixelSize: 1 },
        effects,
      }),
    );

  it("drops a param name the effect does not declare", () => {
    const { preset, warnings } = withEffects([{ type: "blur", params: { r: 2, radius: 4 } }]);
    expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 4 }, enabled: true }]);
    expect(warnings).toEqual(['effect at index 0 (blur) has unknown param "r", dropping']);
  });

  it("clamps an out-of-range value and says so", () => {
    const { preset, warnings } = withEffects([
      { type: "glow", params: { radius: 999, intensity: -4 } },
    ]);
    expect(preset!.effects).toEqual([
      { type: "glow", params: { radius: 20, intensity: 0 }, enabled: true },
    ]);
    expect(warnings).toEqual([
      "effect at index 0 (glow) param radius 999 is outside 0-20, using 20",
      "effect at index 0 (glow) param intensity -4 is outside 0-100, using 0",
    ]);
  });

  it("keeps a value that is already in range quiet", () => {
    const { warnings } = withEffects([{ type: "glow", params: { radius: 4, intensity: 30 } }]);
    expect(warnings).toEqual([]);
  });

  it("replaces a param value that is not a finite number", () => {
    for (const bad of ["4", null, true, Number.NaN]) {
      const { preset, warnings } = withEffects([{ type: "blur", params: { radius: bad } }]);
      expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("param radius is not a finite number, using 2");
    }
  });

  it("fills every declared param from the kernel default when none is given", () => {
    const { preset, warnings } = withEffects([{ type: "glow", params: {} }]);
    expect(warnings).toEqual([]);
    // Defaults come from the kernel registry, not from a copy in this file.
    expect(preset!.effects).toEqual([
      { type: "glow", params: defaultEffectParams("glow"), enabled: true },
    ]);
  });

  it("fills defaults for a missing params field", () => {
    const { preset, warnings } = withEffects([{ type: "sharpen" }]);
    expect(warnings).toEqual([]);
    expect(preset!.effects).toEqual([
      { type: "sharpen", params: defaultEffectParams("sharpen"), enabled: true },
    ]);
  });

  it("reports a params field that is not an object", () => {
    for (const bad of [5, "radius=2", [], null]) {
      const { preset, warnings } = withEffects([{ type: "blur", params: bad }]);
      expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
      expect(warnings).toContain("effect at index 0 (blur) has non-object params, using defaults");
    }
  });

  it("keeps a disabled effect disabled", () => {
    const { preset, warnings } = withEffects([
      { type: "blur", params: { radius: 2 }, enabled: false },
    ]);
    expect(warnings).toEqual([]);
    expect(preset!.effects[0].enabled).toBe(false);
  });

  it("defaults enabled to true and reports a non-boolean one", () => {
    const missing = withEffects([{ type: "blur", params: {} }]);
    expect(missing.warnings).toEqual([]);
    expect(missing.preset!.effects[0].enabled).toBe(true);

    for (const bad of ["false", 0, null, {}]) {
      const { preset, warnings } = withEffects([{ type: "blur", params: {}, enabled: bad }]);
      expect(preset!.effects[0].enabled).toBe(true);
      expect(warnings).toContain("effect at index 0 (blur) has non-boolean enabled, using true");
    }
  });

  it("leaves no effect the kernel would reject", () => {
    // Anything parsePresetJson hands back must survive the worker's own checks.
    const { preset } = withEffects([
      { type: "blur", params: { radius: 9999, junk: 1 } },
      { type: "glow", params: { radius: "x" } },
      { type: "sharpen", params: {}, enabled: "yes" },
      { type: "scanlines", params: { pitch: 2.5, strength: 20 } },
      { type: "gone", params: {} },
    ]);
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    expect(() => applyEffects(pixels, 4, 4, preset!.effects)).not.toThrow();
  });

  it("survives a serialize round trip unchanged", () => {
    const first = withEffects([{ type: "glow", params: { radius: 4, intensity: 30 } }]);
    const text = serializePreset(first.preset!);
    const second = parsePresetJson(text);
    expect(second.warnings).toEqual([]);
    expect(second.preset!.effects).toEqual(first.preset!.effects);
  });
});

describe("preset operations", () => {
  const base: Omit<Preset, "operations"> = {
    version: 1,
    name: "Cropped",
    params: {
      method: "Bayer 4x4",
      threshold: 128,
      palette: "GameBoy",
      color: false,
      pixelSize: 1,
    },
    effects: [],
  };

  it("round-trips an operation set through JSON", () => {
    const operations = {
      crop: { x: 4, y: 8, width: 120, height: 90 },
      rotate: 90 as const,
      flipHorizontal: true,
      brightness: 0.2,
      contrast: -0.1,
      saturation: 0.5,
      hue: -30,
      invert: true,
    };
    const text = serializePreset({ ...base, operations });
    expect(JSON.parse(text).operations).toEqual(operations);
    const back = parsePresetJson(text);
    expect(back.warnings).toEqual([]);
    expect(back.preset!.operations).toEqual(operations);
  });

  it("keeps identity operations out of the file", () => {
    const text = serializePreset({ ...base, operations: { brightness: 0, invert: false } });
    expect("operations" in JSON.parse(text)).toBe(false);
    expect(parsePresetJson(text).preset!.operations).toBeUndefined();
  });

  it("clamps out-of-range operations and drops the unusable ones", () => {
    const { preset, warnings } = parsePresetJson(
      JSON.stringify({
        ...base,
        operations: {
          brightness: 9,
          hue: -900,
          rotate: 12,
          crop: { x: -1, y: 0, width: 0, height: 4 },
        },
      }),
    );
    expect(preset!.operations).toEqual({ brightness: 1, hue: -180 });
    expect(warnings).toEqual([]);
  });

  it("warns when no operation survives sanitizing", () => {
    const { preset, warnings } = parsePresetJson(
      JSON.stringify({ ...base, operations: { rotate: 12, invert: "yes" } }),
    );
    expect(preset!.operations).toBeUndefined();
    expect(warnings).toContain("no usable operations, ignoring");
  });

  it("ignores a non-object operations field", () => {
    const { preset, warnings } = parsePresetJson(JSON.stringify({ ...base, operations: "crop" }));
    expect(preset!.operations).toBeUndefined();
    expect(warnings).toContain("invalid operations, ignoring");
  });
});

/** Names that resolve through Object.prototype rather than PALETTES. */
const INHERITED_NAMES = [
  "toString",
  "constructor",
  "__proto__",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
];

/** A complete preset body, so a test's warnings come only from what it injects. */
function bodyWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    name: "H",
    params: { method: "Bayer 4x4", threshold: 128, palette: "GameBoy", color: false, pixelSize: 1 },
    effects: [],
    ...overrides,
  });
}

describe("hostile palette names", () => {
  it("rejects every name inherited from Object.prototype", () => {
    for (const name of INHERITED_NAMES) {
      const { preset, warnings } = parsePresetJson(
        bodyWith({ params: { method: "Bayer 4x4", threshold: 128, palette: name, pixelSize: 1 } }),
      );
      // `name in PALETTES` would have accepted these and handed the kernel a
      // function or Object.prototype instead of a list of colours.
      expect(preset!.params.palette).toBe("B&W");
      expect(warnings).toContain(`unknown palette "${name}", using B&W`);
    }
  });

  it("still accepts every palette the kernel registers", () => {
    for (const name of Object.keys(PALETTES)) {
      const { preset, warnings } = parsePresetJson(
        bodyWith({
          params: { method: "Bayer 4x4", threshold: 128, palette: name, pixelSize: 1 },
        }),
      );
      expect(preset!.params.palette).toBe(name);
      expect(warnings).toEqual([]);
    }
  });

  it("is case sensitive, so a near miss is still a miss", () => {
    const { preset, warnings } = parsePresetJson(
      bodyWith({
        params: { method: "Bayer 4x4", threshold: 128, palette: "gameboy", pixelSize: 1 },
      }),
    );
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toContain('unknown palette "gameboy", using B&W');
  });

  it("does not let a hostile name through the custom branch either", () => {
    for (const name of INHERITED_NAMES) {
      const { preset, warnings } = parsePresetJson(
        bodyWith({ params: { palette: { custom: name } } }),
      );
      expect(preset!.params.palette).toBe("B&W");
      // Not a list at all, so it falls through to the generic complaint.
      expect(warnings).toContain("invalid palette, using B&W");
    }
  });

  it("rejects a custom list whose entries are not colours", () => {
    for (const name of INHERITED_NAMES) {
      const { preset, warnings } = parsePresetJson(
        bodyWith({ params: { palette: { custom: [name, [0, 0, 0]] } } }),
      );
      expect(preset!.params.palette).toBe("B&W");
      expect(warnings).toContain("custom palette needs 2-16 valid colors, using B&W");
    }
  });
});

describe("preset params through the kernel", () => {
  const image = (): RGBAImage => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i * 7) % 256;
      data[i + 1] = (i * 13) % 256;
      data[i + 2] = (i * 29) % 256;
      data[i + 3] = 255;
    }
    return { width: 8, height: 8, data };
  };

  const render = (text: string): Uint8ClampedArray => {
    const { preset } = parsePresetJson(text);
    const params = presetToParams(preset!);
    return ditherRGBA(image(), {
      color: params.color,
      method: params.method,
      threshold: params.threshold,
      palette: params.palette,
      pixelSize: params.pixelSize,
    });
  };

  it("renders a normal palette preset to a full frame", () => {
    const out = render(bodyWith({}));
    expect(out).toHaveLength(8 * 8 * 4);
  });

  it("renders a hostile palette preset instead of failing the render", () => {
    // The gate that matters: what the store hands the worker is always usable.
    for (const name of INHERITED_NAMES) {
      expect(() =>
        render(
          bodyWith({
            params: { method: "Bayer 4x4", threshold: 128, palette: name, pixelSize: 1 },
          }),
        ),
      ).not.toThrow();
    }
  });

  it("would have thrown for an inherited name that slipped through validation", () => {
    // Guards the premise of the tests above: the kernel rejects these itself.
    expect(() =>
      ditherRGBA(image(), { color: false, method: "Bayer 4x4", palette: "toString" }),
    ).toThrow(/unknown palette/);
  });

  it("renders a custom palette and a preset with effects", () => {
    const out = render(
      bodyWith({
        params: {
          method: "Stucki",
          threshold: 150,
          palette: {
            custom: [
              [0, 0, 0],
              [255, 0, 0],
            ],
          },
          color: true,
          pixelSize: 2,
        },
        effects: [{ type: "glow", params: { radius: 2, intensity: 20 }, enabled: true }],
      }),
    );
    expect(out).toHaveLength(8 * 8 * 4);
  });
});

describe("prototype-key safety in serialized output", () => {
  it("never accepts a prototype name as an effect type", () => {
    for (const name of INHERITED_NAMES) {
      const { preset, warnings } = parsePresetJson(
        bodyWith({ effects: [{ type: name, params: {} }] }),
      );
      expect(preset!.effects).toEqual([]);
      expect(warnings).toContain(`unknown effect type "${name}" at index 0, dropping`);
    }
  });

  it("drops a __proto__ param key instead of letting it through", () => {
    // JSON.parse makes __proto__ an own key, so this reaches the param check.
    const { preset, warnings } = parsePresetJson(
      '{"version":1,"name":"P","params":{"method":"Bayer 4x4","threshold":128,"palette":"GameBoy",' +
        '"pixelSize":1},"effects":[{"type":"blur","params":{"__proto__":{"radius":99}}}]}',
    );
    expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
    expect(warnings).toContain('effect at index 0 (blur) has unknown param "__proto__", dropping');
  });

  it("never writes a __proto__ key into the serialized file", () => {
    const { preset } = parsePresetJson(
      bodyWith({ effects: [{ type: "blur", params: { __proto__: { radius: 9 }, radius: 3 } }] }),
    );
    const text = serializePreset(preset!);
    expect(text).not.toContain("__proto__");
    expect(Object.keys(JSON.parse(text).effects[0].params)).toEqual(["radius"]);
  });

  it("leaves Object.prototype untouched by a hostile payload", () => {
    const before = Object.getOwnPropertyNames(Object.prototype).length;
    parsePresetJson(
      '{"__proto__":{"polluted":true},"version":1,"name":"P",' +
        '"params":{"palette":"toString"},"effects":[{"type":"constructor","params":{"x":1}}],' +
        '"operations":{"__proto__":{"brightness":1}}}',
    );
    expect(Object.getOwnPropertyNames(Object.prototype)).toHaveLength(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).brightness).toBeUndefined();
  });

  it("keeps the version a plain number, whatever the file claims", () => {
    for (const version of [2, "1", null, { toString: 1 }, [1]]) {
      const { preset, warnings } = parsePresetJson(bodyWith({ version }));
      expect(preset!.version).toBe(PRESET_VERSION);
      expect(typeof preset!.version).toBe("number");
      expect(warnings).toContain(`unsupported version, reading as v${PRESET_VERSION}`);
    }
  });

  it("round-trips a preset carrying a hostile palette through a file", () => {
    const first = parsePresetJson(
      bodyWith({
        params: { method: "Bayer 4x4", threshold: 128, palette: "toString", pixelSize: 1 },
      }),
    );
    const text = serializePreset(first.preset!);
    expect(JSON.parse(text).params.palette).toBe("B&W");
    const second = parsePresetJson(text);
    expect(second.warnings).toEqual([]);
    expect(second.preset).toEqual(first.preset);
  });
});
