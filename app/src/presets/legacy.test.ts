import { describe, expect, it } from "vitest";
import { isLegacyPreset, migrateLegacyPreset } from "./legacy";
import { parsePresetJson } from "./schema";

/** A trimmed but representative legacy file: every documented field present. */
const BLUE_INK = {
  method: "Clustered-Dot",
  pixel_size: 6,
  threshold: 221,
  brightness: 1.24,
  contrast: 1.36,
  saturation: 0.48,
  hue_rotate: 51,
  blur: 1,
  sharpen: 3,
  pre_denoise: 0,
  pre_smooth: 0,
  color: [245, 45, 239],
  glow_radius: 2,
  glow_intensity: 33,
  post_denoise: 0,
  post_smooth: 0,
  palette_name: "NES",
  custom_palette: null,
};

describe("legacy detection", () => {
  it("recognises the flat shape", () => {
    expect(isLegacyPreset(BLUE_INK)).toBe(true);
    expect(isLegacyPreset({ hue_rotate: 90 })).toBe(true);
  });

  it("recognises a minimal preset carrying only shared field names", () => {
    for (const key of ["method", "threshold", "brightness", "contrast", "saturation", "color"]) {
      expect(isLegacyPreset({ [key]: 1 })).toBe(true);
      expect(isLegacyPreset({ [key]: 1, name: "x" })).toBe(true);
    }
    expect(isLegacyPreset({ method: "Bayer 4x4" })).toBe(true);
    expect(isLegacyPreset({ method: "Bayer 4x4", threshold: 90, saturation: 1.5 })).toBe(true);
  });

  it("needs a field it recognises, not just an object", () => {
    expect(isLegacyPreset({})).toBe(false);
    expect(isLegacyPreset({ name: "Untitled" })).toBe(false);
    expect(isLegacyPreset({ future: true, other: 1 })).toBe(false);
  });

  it("leaves v1 presets to the v1 parser even with junk keys", () => {
    expect(isLegacyPreset({ version: 1, params: {}, pixel_size: 4 })).toBe(false);
    expect(isLegacyPreset({ params: { method: "Atkinson" } })).toBe(false);
    expect(isLegacyPreset({ effects: [] })).toBe(false);
    expect(isLegacyPreset({ version: 1, method: "Atkinson" })).toBe(false);
    expect(isLegacyPreset({ params: { method: "Atkinson" }, threshold: 90 })).toBe(false);
  });

  it("is false for non-objects", () => {
    expect(isLegacyPreset([1, 2])).toBe(false);
    expect(isLegacyPreset("blue ink")).toBe(false);
    expect(isLegacyPreset(null)).toBe(false);
  });
});

describe("minimal legacy migration", () => {
  it("migrates a preset that only names a method", () => {
    const { preset, warnings } = parsePresetJson(JSON.stringify({ method: "Atkinson" }), "Tiny");
    expect(preset!.name).toBe("Tiny");
    expect(preset!.params.method).toBe("Atkinson");
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.params.pixelSize).toBe(1);
    expect(preset!.params.palette).toBe("B&W");
    expect(preset!.effects).toEqual([]);
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("migrates a preset that only carries colour multipliers", () => {
    const { preset, warnings } = migrateLegacyPreset({
      brightness: 1.2,
      contrast: 0.8,
      saturation: 1.5,
    });
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(preset!.operations).toEqual({ brightness: 0.2, contrast: -0.2, saturation: 0.5 });
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("takes a minimal file through parsePresetJson without a version", () => {
    const { preset, warnings } = parsePresetJson(JSON.stringify({ threshold: 200 }));
    expect(preset!.params.threshold).toBe(200);
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("still leaves an empty object to the v1 parser", () => {
    const { preset, warnings } = parsePresetJson("{}");
    expect(preset!.name).toBe("Untitled");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("legacy"))).toBe(false);
  });
});

describe("legacy migration", () => {
  it("maps params, operations and effects", () => {
    const { preset, warnings } = migrateLegacyPreset(BLUE_INK, "Blue Ink");
    expect(preset!.version).toBe(1);
    expect(preset!.name).toBe("Blue Ink");
    expect(preset!.params).toEqual({
      method: "Clustered-Dot",
      threshold: 221,
      palette: "NES",
      color: false,
      pixelSize: 6,
    });
    // Multipliers become deltas, so a legacy 1.24 becomes +0.24.
    expect(preset!.operations).toEqual({
      brightness: 0.24,
      contrast: 0.36,
      saturation: -0.52,
      hue: 51,
    });
    expect(preset!.effects).toEqual([
      { type: "blur", params: { radius: 1 }, enabled: true },
      { type: "sharpen", params: { amount: 3 }, enabled: true },
      { type: "glow", params: { radius: 2, intensity: 33 }, enabled: true },
    ]);
    expect(warnings[0]).toBe("legacy Dither Guy preset, migrated");
  });

  it("warns that blur and sharpen moved after dithering", () => {
    const { warnings } = migrateLegacyPreset(BLUE_INK);
    expect(warnings).toContain("blur ran before dithering, now applied after it");
    expect(warnings).toContain("sharpen ran before dithering, now applied after it");
  });

  it("warns that the replacement colour is dropped", () => {
    const { preset, warnings } = migrateLegacyPreset(BLUE_INK);
    expect(
      warnings.some((w) => w.includes("replacement color [245, 45, 239] is not supported")),
    ).toBe(true);
    // A legacy colour triple must never be read as the v1 colour-mode flag.
    expect(preset!.params.color).toBe(false);
  });

  it("stays quiet about zero-valued denoise and smooth fields", () => {
    const { warnings } = migrateLegacyPreset(BLUE_INK);
    expect(warnings.filter((w) => w.includes("denoise") || w.includes("smooth"))).toEqual([]);
  });

  it("warns for every unsupported field that is actually set", () => {
    const { warnings } = migrateLegacyPreset({
      pixel_size: 2,
      pre_denoise: 3,
      pre_smooth: 2,
      post_denoise: 4,
      post_smooth: 3,
    });
    expect(warnings).toContain(
      "pre_denoise 3 (median denoise before dithering) is not supported: dither-ts has no median filter",
    );
    expect(warnings).toContain(
      "post_denoise 4 (median denoise after dithering) is not supported: dither-ts has no median filter",
    );
    expect(warnings).toContain(
      "pre_smooth 2 (gaussian smooth before dithering) is not supported: dither-ts blurs only after dithering",
    );
  });

  it("maps post_smooth onto a blur of strength * 0.5", () => {
    const { preset, warnings } = migrateLegacyPreset({ post_smooth: 4, glow_radius: 0 });
    expect(preset!.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
    expect(warnings.some((w) => w.includes("post_smooth"))).toBe(false);
  });

  it("skips a glow with no radius and defaults its intensity", () => {
    expect(migrateLegacyPreset({ glow_radius: 0, glow_intensity: 60 }).preset!.effects).toEqual([]);
    expect(migrateLegacyPreset({ glow_radius: 4 }).preset!.effects).toEqual([
      { type: "glow", params: { radius: 4, intensity: 30 }, enabled: true },
    ]);
  });

  it("clamps out-of-range values and says so", () => {
    const { preset, warnings } = migrateLegacyPreset({
      pixel_size: 99,
      threshold: 999,
      brightness: 3,
      contrast: -1,
      // A legacy 0 means fully desaturated, which is a real setting, not a clamp.
      saturation: 0,
    });
    expect(preset!.params.pixelSize).toBe(1);
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.operations).toEqual({ brightness: 1, contrast: -1, saturation: -1 });
    expect(warnings).toContain("pixel_size 99 is not a whole 1-8, using 1");
    expect(warnings).toContain("threshold 999 is out of range 1-254, using 128");
    expect(warnings).toContain("brightness 3 is out of range 0-2, clamped");
    expect(warnings).toContain("contrast -1 is out of range 0-2, clamped");
    // saturation 0 is greyscale, which lands on the edge and needs no clamp.
    expect(warnings.some((w) => w.startsWith("saturation"))).toBe(false);
  });

  it("drops identity multipliers instead of storing zeros", () => {
    const { preset, warnings } = migrateLegacyPreset({
      method: "Bayer 4x4",
      threshold: 128,
      pixel_size: 1,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      hue_rotate: 0,
    });
    expect(preset!.operations).toBeUndefined();
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
    expect(preset!.name).toBe("Untitled");
  });

  it("stays quiet about fields a minimal legacy file leaves out", () => {
    // Omitting a field is the file's choice, not a defect: only bad values warn.
    const { preset, warnings } = migrateLegacyPreset({ method: "Bayer 4x4" });
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
    expect(preset!.params.method).toBe("Bayer 4x4");
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.params.pixelSize).toBe(1);
  });

  it("defaults a minimal file that names nothing at all", () => {
    const { preset, warnings } = migrateLegacyPreset({ threshold: 90 });
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(preset!.params.threshold).toBe(90);
  });

  it("warns about a field that is present but not a number", () => {
    const { preset, warnings } = migrateLegacyPreset({
      method: 4,
      threshold: "x",
      pixel_size: null,
      brightness: "1.2",
      contrast: true,
      saturation: [],
      hue_rotate: {},
      blur: "soft",
      sharpen: NaN,
      glow_radius: "wide",
      post_smooth: null,
    });
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(preset!.params.threshold).toBe(128);
    expect(preset!.params.pixelSize).toBe(1);
    expect(preset!.operations).toBeUndefined();
    expect(preset!.effects).toEqual([]);
    expect(warnings).toContain("method 4 is not a dither-ts method, using Floyd-Steinberg");
    expect(warnings).toContain('threshold "x" is not a number, using 128');
    expect(warnings).toContain("pixel_size null is not a number, using 1");
    expect(warnings).toContain('brightness "1.2" is not a number, ignored');
    expect(warnings).toContain("contrast true is not a number, ignored");
    expect(warnings).toContain("saturation a list is not a number, ignored");
    expect(warnings).toContain("hue_rotate an object is not a number, ignored");
    expect(warnings).toContain('blur "soft" is not a number, ignored');
    expect(warnings).toContain("sharpen NaN is not a number, ignored");
    expect(warnings).toContain('glow_radius "wide" is not a number, ignored');
    expect(warnings).toContain("post_smooth null is not a number, ignored");
  });

  it("distinguishes an omitted field from one set to a wrong type", () => {
    const absent = migrateLegacyPreset({ method: "Bayer 4x4" }).warnings;
    const wrongType = migrateLegacyPreset({ method: "Bayer 4x4", contrast: "1" }).warnings;
    expect(absent).toHaveLength(1);
    expect(wrongType).toHaveLength(2);
    expect(wrongType).toContain('contrast "1" is not a number, ignored');
  });

  it("warns for a glow intensity with no radius to act on", () => {
    const { preset, warnings } = migrateLegacyPreset({ glow_intensity: 40 });
    expect(preset!.effects).toEqual([]);
    expect(warnings).toContain("glow_intensity 40 has no glow_radius to act on, ignored");
    // A zero intensity asks for nothing, so it is not a lost setting.
    expect(migrateLegacyPreset({ glow_intensity: 0 }).warnings).toEqual([
      "legacy Dither Guy preset, migrated",
    ]);
    // Neither does a radius on its own.
    expect(migrateLegacyPreset({ glow_radius: 0, glow_intensity: 40 }).warnings).toContain(
      "glow_intensity 40 has no glow_radius to act on, ignored",
    );
  });

  it("keeps a valid glow intensity with its radius", () => {
    const { preset, warnings } = migrateLegacyPreset({ glow_radius: 4, glow_intensity: 60 });
    expect(preset!.effects).toEqual([
      { type: "glow", params: { radius: 4, intensity: 60 }, enabled: true },
    ]);
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("prefers a negative radius complaint over an orphaned intensity", () => {
    const { warnings } = migrateLegacyPreset({ glow_radius: -3, glow_intensity: 40 });
    expect(warnings).toContain("glow_radius -3 is negative, ignored");
    expect(warnings.some((w) => w.includes("no glow_radius"))).toBe(false);
  });

  it("reports a malformed denoise or smooth value as a bad number", () => {
    const { warnings } = migrateLegacyPreset({
      pre_denoise: "3",
      pre_smooth: null,
      post_denoise: [],
      post_smooth: {},
    });
    expect(warnings).toContain('pre_denoise "3" is not a number, ignored');
    expect(warnings).toContain("pre_smooth null is not a number, ignored");
    expect(warnings).toContain("post_denoise a list is not a number, ignored");
    expect(warnings).toContain("post_smooth an object is not a number, ignored");
    // A bad value is a bad value, not a claim that the filter is supported.
    expect(warnings.some((w) => w.includes("median denoise before"))).toBe(false);
  });

  it("stays quiet about denoise and smooth fields that are absent or zero", () => {
    expect(migrateLegacyPreset({ method: "Bayer 4x4" }).warnings).toHaveLength(1);
    expect(
      migrateLegacyPreset({ pre_denoise: 0, pre_smooth: 0, post_denoise: 0, post_smooth: 0 })
        .warnings,
    ).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("reports a replacement colour of the wrong shape", () => {
    const { warnings } = migrateLegacyPreset({ color: "red" });
    expect(warnings).toContain('replacement color "red" is not an RGB triple, ignored');
  });

  it("does not treat a null replacement colour as a problem", () => {
    expect(migrateLegacyPreset({ color: null }).warnings).toEqual([
      "legacy Dither Guy preset, migrated",
    ]);
  });

  it("wraps hue_rotate into the -180..180 range operations accept", () => {
    expect(migrateLegacyPreset({ hue_rotate: 203 }).preset!.operations).toEqual({ hue: -157 });
    expect(migrateLegacyPreset({ hue_rotate: 203 }).warnings).toContain(
      "hue_rotate 203 wrapped to -157 degrees",
    );
    expect(migrateLegacyPreset({ hue_rotate: -30 }).preset!.operations).toEqual({ hue: -30 });
  });

  it("matches palette names case-insensitively and reports the rename", () => {
    const { preset, warnings } = migrateLegacyPreset({ palette_name: "Gameboy" });
    expect(preset!.params.palette).toBe("GameBoy");
    expect(warnings).toContain('palette_name "Gameboy" renamed to "GameBoy"');
  });

  it("warns for a palette dither-ts does not ship", () => {
    const { preset, warnings } = migrateLegacyPreset({ palette_name: "CGA Palette 1 High" });
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toContain(
      'palette_name "CGA Palette 1 High" is not a dither-ts palette, using B&W',
    );
  });

  it("reports a palette name that is not a string", () => {
    const { preset, warnings } = migrateLegacyPreset({ palette_name: 7 });
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toContain("palette_name 7 is not a string, using B&W");
  });

  it("stays quiet about a palette name that is absent", () => {
    const { preset, warnings } = migrateLegacyPreset({ method: "Bayer 4x4" });
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toEqual(["legacy Dither Guy preset, migrated"]);
  });

  it("prefers a valid custom palette over the named one", () => {
    const { preset } = migrateLegacyPreset({
      palette_name: "NES",
      custom_palette: [
        [0, 0, 0],
        [255, 0, 0],
      ],
    });
    expect(preset!.params.palette).toEqual({
      custom: [
        [0, 0, 0],
        [255, 0, 0],
      ],
    });
  });

  it("rejects a custom palette outside the 2-16 window and counts the rejects", () => {
    const { preset, warnings } = migrateLegacyPreset({
      custom_palette: [
        [300, 0, 0],
        [0, 0, 0],
      ],
    });
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toContain("custom_palette: dropped 1 invalid colors");
    expect(warnings).toContain("custom_palette has 1 colors, needs 2-16, using palette_name");
  });

  it("falls back to the name when the custom palette is unusable", () => {
    const { preset, warnings } = migrateLegacyPreset({
      palette_name: "Gruvbox",
      custom_palette: [],
    });
    expect(preset!.params.palette).toBe("Gruvbox");
    expect(warnings).toContain("custom_palette has 0 colors, needs 2-16, using palette_name");
  });

  it("reports a custom palette that is not a list", () => {
    const { preset, warnings } = migrateLegacyPreset({ custom_palette: "red" });
    expect(preset!.params.palette).toBe("B&W");
    expect(warnings).toContain("custom_palette is not a list, ignoring");
  });

  it("reports unknown fields and an unknown method", () => {
    const { preset, warnings } = migrateLegacyPreset({ method: "Chaos", weird: 1, extra: 2 });
    expect(preset!.params.method).toBe("Floyd-Steinberg");
    expect(warnings).toContain('method "Chaos" is not a dither-ts method, using Floyd-Steinberg');
    expect(warnings).toContain('ignoring unknown legacy field "weird"');
    expect(warnings).toContain('ignoring unknown legacy field "extra"');
  });

  it("reports a non-numeric method, threshold and pixel_size", () => {
    const { warnings } = migrateLegacyPreset({ method: 4, threshold: "x", pixel_size: null });
    expect(warnings).toContain("method 4 is not a dither-ts method, using Floyd-Steinberg");
    expect(warnings).toContain('threshold "x" is not a number, using 128');
    expect(warnings).toContain("pixel_size null is not a number, using 1");
  });

  it("prefers the file's own name over the hint", () => {
    expect(migrateLegacyPreset({ name: "  CRT  " }, "CRT.json").preset!.name).toBe("CRT");
    expect(migrateLegacyPreset({ name: 7 }, "hint").preset!.name).toBe("hint");
  });

  it("rejects negative radii instead of storing them", () => {
    const { preset, warnings } = migrateLegacyPreset({
      blur: -2,
      sharpen: -1,
      glow_radius: -3,
      post_smooth: -1,
    });
    expect(preset!.effects).toEqual([]);
    expect(warnings).toContain("blur -2 is negative, ignored");
    expect(warnings).toContain("sharpen -1 is negative, ignored");
    expect(warnings).toContain("glow_radius -3 is negative, ignored");
    expect(warnings).toContain("post_smooth -1 is negative, ignored");
  });
});

describe("parsePresetJson with legacy input", () => {
  it("migrates without the caller knowing the format", () => {
    const { preset, warnings } = parsePresetJson(JSON.stringify(BLUE_INK), "Blue Ink");
    expect(preset!.name).toBe("Blue Ink");
    expect(preset!.params.method).toBe("Clustered-Dot");
    expect(warnings.length).toBeGreaterThan(2);
  });

  it("does not add a legacy warning for a v1 preset", () => {
    const { warnings } = parsePresetJson(
      JSON.stringify({ version: 1, name: "X", params: { method: "Atkinson" }, effects: [] }),
    );
    expect(warnings.some((w) => w.includes("legacy"))).toBe(false);
  });
});
