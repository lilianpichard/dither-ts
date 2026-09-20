// Preset JSON v1: versioned, forward-tolerant, never throws on load.
// Unknown fields are ignored; invalid fields fall back to defaults
// with a warning. See docs/presets.md.

import { METHOD_NAMES } from "../../../src/index.js";
import { PALETTES, type RGB } from "../../../src/index.js";

export const PRESET_VERSION = 1;

export interface PresetEffect {
  type: string;
  params: Record<string, number>;
  enabled: boolean;
}

export type PresetPalette = string | { custom: RGB[] };

export interface PresetParams {
  method: string;
  threshold: number;
  palette: PresetPalette;
  color: boolean;
  pixelSize: number;
}

export interface Preset {
  version: number;
  name: string;
  params: PresetParams;
  effects: PresetEffect[];
}

export interface ParseResult {
  preset: Preset | null;
  warnings: string[];
}

const DEFAULTS: PresetParams = {
  method: "Floyd-Steinberg",
  threshold: 128,
  palette: "B&W",
  color: false,
  pixelSize: 1,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validColor(v: unknown): v is RGB {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255)
  );
}

function parsePalette(v: unknown, warnings: string[]): PresetPalette {
  if (typeof v === "string") {
    if (v in PALETTES) return v;
    warnings.push(`unknown palette "${v}", using B&W`);
    return "B&W";
  }
  if (isRecord(v) && Array.isArray(v.custom)) {
    const colors = (v.custom as unknown[]).filter(validColor) as RGB[];
    if (colors.length >= 2 && colors.length <= 16) return { custom: colors };
    warnings.push("custom palette needs 2-16 valid colors, using B&W");
    return "B&W";
  }
  warnings.push("invalid palette, using B&W");
  return "B&W";
}

function parseEffect(v: unknown, index: number, warnings: string[]): PresetEffect | null {
  if (!isRecord(v) || typeof v.type !== "string" || v.type.length === 0) {
    warnings.push(`dropping invalid effect at index ${index}`);
    return null;
  }
  const params: Record<string, number> = {};
  if (isRecord(v.params)) {
    for (const [k, val] of Object.entries(v.params)) {
      if (typeof val === "number" && Number.isFinite(val)) params[k] = val;
    }
  }
  return { type: v.type, params, enabled: v.enabled !== false };
}

function parseParams(v: unknown, warnings: string[]): PresetParams {
  const o = isRecord(v) ? v : {};
  if (!isRecord(v)) warnings.push("missing params, using defaults");
  let method = DEFAULTS.method;
  if (typeof o.method === "string" && (METHOD_NAMES as readonly string[]).includes(o.method)) {
    method = o.method;
  } else {
    warnings.push(`unknown method "${String(o.method)}", using Floyd-Steinberg`);
  }
  let threshold = DEFAULTS.threshold;
  if (typeof o.threshold === "number" && o.threshold >= 1 && o.threshold <= 254) {
    threshold = Math.round(o.threshold);
  } else {
    warnings.push("invalid threshold, using 128");
  }
  let color = DEFAULTS.color;
  if (typeof o.color === "boolean") color = o.color;
  let pixelSize = DEFAULTS.pixelSize;
  if (
    Number.isInteger(o.pixelSize) &&
    (o.pixelSize as number) >= 1 &&
    (o.pixelSize as number) <= 8
  ) {
    pixelSize = o.pixelSize as number;
  } else {
    warnings.push("invalid pixelSize, using 1");
  }
  return { method, threshold, palette: parsePalette(o.palette, warnings), color, pixelSize };
}

/** Parse preset JSON text. Returns null preset only for non-object input. */
export function parsePresetJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { preset: null, warnings: ["not valid JSON"] };
  }
  if (!isRecord(raw)) return { preset: null, warnings: ["preset must be an object"] };
  const warnings: string[] = [];
  if (raw.version !== PRESET_VERSION)
    warnings.push(`unsupported version, reading as v${PRESET_VERSION}`);
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "Untitled";
  if (name === "Untitled") warnings.push("missing name, using Untitled");
  const params = parseParams(raw.params, warnings);
  const effects: PresetEffect[] = [];
  if (Array.isArray(raw.effects)) {
    raw.effects.forEach((e, i) => {
      const parsed = parseEffect(e, i, warnings);
      if (parsed) effects.push(parsed);
    });
  }
  return { preset: { version: PRESET_VERSION, name, params, effects }, warnings };
}

/** Serialize a preset to canonical JSON. */
export function serializePreset(preset: Preset): string {
  return JSON.stringify(
    { version: PRESET_VERSION, name: preset.name, params: preset.params, effects: preset.effects },
    null,
    2,
  );
}
