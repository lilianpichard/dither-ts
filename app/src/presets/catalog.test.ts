import { beforeEach, describe, expect, it } from "vitest";
import { applyEffects } from "../../../src/index.js";
import { catalogEntries, loadCatalog, parseCatalogEntry } from "./catalog";
import { parsePresetJson, serializePreset } from "./schema";
import { usePresets } from "./store";
import { isIdentity, sanitizeOperations } from "../image/settings";

/** The 13 presets that shipped with the Dither Guy repo. */
const ORIGINALS = [
  "Blue Ink",
  "CGA Retro",
  "CRT",
  "Gold Spark",
  "Magenta Shade",
  "Ocean Blue",
  "Pink Settle",
  "Purple Crayon",
  "Red Sea",
  "Retro Gameboy",
  "Sonic",
  "Star Dust",
  "Vaporwave CRT",
];

beforeEach(() => {
  usePresets.setState({ items: [] });
});

describe("bundled catalog", () => {
  it("carries all 13 originals, name-sorted", () => {
    expect(catalogEntries().map((entry) => entry.name)).toEqual(ORIGINALS);
  });

  it("migrates every one of them without dropping it", () => {
    const loaded = loadCatalog();
    expect(loaded).toHaveLength(13);
    for (const { preset, warnings } of loaded) {
      expect(preset).not.toBeNull();
      expect(preset.name).not.toBe("");
      // Every bundled preset is legacy, so a note here is expected. What must
      // never appear is a blanket "migrated" line repeated once per preset.
      expect(warnings).not.toContain("legacy Dither Guy preset, migrated");
    }
  });

  it("always says what the migration could not carry", () => {
    for (const { warnings } of loadCatalog()) {
      expect(warnings.length).toBeGreaterThan(0);
    }
  });

  it("names a preset after its file, since legacy files carry no name", () => {
    const entry = catalogEntries().find((e) => e.name === "Vaporwave CRT")!;
    expect(parseCatalogEntry(entry).preset!.name).toBe("Vaporwave CRT");
  });

  it("lands on values the v1 schema and kernel accept", () => {
    for (const { preset } of loadCatalog()) {
      expect(preset.version).toBe(1);
      expect(preset.params.threshold).toBeGreaterThanOrEqual(1);
      expect(preset.params.threshold).toBeLessThanOrEqual(254);
      expect(preset.params.pixelSize).toBeGreaterThanOrEqual(1);
      expect(preset.params.pixelSize).toBeLessThanOrEqual(8);
      // Operations only ever hold sanitized values, or nothing at all.
      if (preset.operations) expect(isIdentity(preset.operations)).toBe(false);
      expect(sanitizeOperations(preset.operations)).toEqual(preset.operations);
    }
  });

  it("reproduces a known preset exactly", () => {
    const entry = catalogEntries().find((e) => e.name === "Blue Ink")!;
    const { preset } = parseCatalogEntry(entry);
    expect(preset!.params).toEqual({
      method: "Clustered-Dot",
      threshold: 221,
      palette: "NES",
      color: false,
      pixelSize: 6,
    });
    expect(preset!.operations).toEqual({
      brightness: 0.24,
      contrast: 0.36,
      saturation: -0.52,
      hue: 51,
    });
  });

  it("emits effects the kernel registry accepts", () => {
    // Migration builds effects directly, so re-parse through the schema to prove
    // nothing unregistered or out of range slipped past the effect validator.
    for (const { preset } of loadCatalog()) {
      const again = parsePresetJson(serializePreset(preset));
      expect(again.warnings).toEqual([]);
      expect(again.preset!.effects).toEqual(preset.effects);
      const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(128);
      expect(() => applyEffects(pixels, 8, 8, preset.effects)).not.toThrow();
    }
  });
});

describe("installCatalog", () => {
  it("adds the originals to an empty gallery", () => {
    const { added, warnings } = usePresets.getState().installCatalog();
    expect(added).toBe(13);
    expect(warnings.length).toBeGreaterThan(13);
    expect(usePresets.getState().items.map((i) => i.preset.name)).toEqual(ORIGINALS);
  });

  it("adds nothing on a second run", () => {
    usePresets.getState().installCatalog();
    const second = usePresets.getState().installCatalog();
    expect(second.added).toBe(0);
    expect(second.warnings).toEqual([]);
    expect(usePresets.getState().items).toHaveLength(13);
  });

  it("respects a same-named preset the user already has", () => {
    usePresets.setState({
      items: [
        {
          id: "keep",
          favorite: false,
          preset: {
            version: 1,
            name: "CRT",
            params: {
              method: "Atkinson",
              threshold: 64,
              palette: "GameBoy",
              color: false,
              pixelSize: 1,
            },
            effects: [],
          },
        },
      ],
    });
    const { added } = usePresets.getState().installCatalog();
    expect(added).toBe(12);
    const crt = usePresets.getState().items.filter((i) => i.preset.name === "CRT");
    expect(crt).toHaveLength(1);
    expect(crt[0].id).toBe("keep");
  });
});
