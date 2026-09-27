// Preset JSON v1: versioned, forward-tolerant, never throws on load.
// Unknown fields are ignored; invalid fields fall back to defaults
// with a warning. Legacy Dither Guy files are detected and migrated here so
// importers have one path. See docs/presets.md.

import { EFFECT_DEFS, METHOD_NAMES } from "../../../src/index.js";
import type { ColorMode, DitherMethod, EffectDef } from "../../../src/index.js";
import { PALETTES, type RGB } from "../../../src/index.js";
import { isIdentity, sanitizeOperations } from "../image/settings";
import type { ImageOperations } from "../image/ops";
import { isLegacyPreset, migrateLegacyPreset } from "./legacy";
import { PRESET_VERSION } from "./version";

export interface PresetEffect {
  type: string;
  params: Record<string, number>;
  enabled: boolean;
}

export type PresetPalette = string | { custom: RGB[] };

export interface PresetParams {
  method: DitherMethod;
  threshold: number;
  palette: PresetPalette;
  color: boolean;
  /**
   * Optional so every preset written before the field existed still parses and
   * still means "palette" — which is exactly what it did. Absent is not an
   * error and needs no migration.
   */
  colorMode?: ColorMode;
  pixelSize: number;
}

export interface Preset {
  version: number;
  name: string;
  params: PresetParams;
  effects: PresetEffect[];
  /** Pre-dither geometry and colour operations; absent means identity. */
  operations?: ImageOperations;
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

function isDitherMethod(value: unknown): value is DitherMethod {
  return typeof value === "string" && (METHOD_NAMES as readonly string[]).includes(value);
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
    // Own properties only: `in` would accept "toString" and friends, handing
    // the kernel a function where it expects colours.
    if (Object.hasOwn(PALETTES, v)) return v;
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

/** The kernel's effect registry, the only authority on what an effect may be. */
const EFFECT_BY_TYPE = new Map(EFFECT_DEFS.map((def) => [def.type, def]));

/**
 * One effect's params, resolved against the kernel registry. Every declared
 * param ends up present, finite, and inside its range; unknown names and bad
 * values are reported rather than left to fail later inside the worker.
 */
function parseEffectParams(
  def: EffectDef,
  raw: unknown,
  label: string,
  warnings: string[],
): Record<string, number> {
  if (raw !== undefined && !isRecord(raw)) {
    warnings.push(`effect ${label} has non-object params, using defaults`);
  }
  const supplied = isRecord(raw) ? raw : {};
  const params: Record<string, number> = {};
  for (const spec of def.params) {
    // Own lookup, so a prototype key can never stand in for a declared param.
    const value = Object.hasOwn(supplied, spec.key) ? supplied[spec.key] : undefined;
    if (value === undefined) {
      params[spec.key] = spec.def;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      warnings.push(`effect ${label} param ${spec.key} is not a finite number, using ${spec.def}`);
      params[spec.key] = spec.def;
      continue;
    }
    const clamped = Math.min(spec.max, Math.max(spec.min, value));
    if (clamped !== value) {
      warnings.push(
        `effect ${label} param ${spec.key} ${value} is outside ${spec.min}-${spec.max}, using ${clamped}`,
      );
    }
    params[spec.key] = clamped;
  }
  const declared = new Set(def.params.map((spec) => spec.key));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) warnings.push(`effect ${label} has unknown param "${key}", dropping`);
  }
  return params;
}

/**
 * One entry of the `effects` array. An unregistered type is dropped outright:
 * the worker throws on one, so letting it through would break the render
 * rather than degrade it.
 */
function parseEffect(v: unknown, index: number, warnings: string[]): PresetEffect | null {
  if (!isRecord(v) || typeof v.type !== "string" || v.type.length === 0) {
    warnings.push(`dropping invalid effect at index ${index}`);
    return null;
  }
  const def = EFFECT_BY_TYPE.get(v.type);
  if (!def) {
    warnings.push(`unknown effect type "${v.type}" at index ${index}, dropping`);
    return null;
  }
  const label = `at index ${index} (${v.type})`;
  let enabled = true;
  if (Object.hasOwn(v, "enabled")) {
    if (typeof v.enabled === "boolean") enabled = v.enabled;
    else warnings.push(`effect ${label} has non-boolean enabled, using true`);
  }
  return { type: v.type, params: parseEffectParams(def, v.params, label, warnings), enabled };
}

function parseParams(v: unknown, warnings: string[]): PresetParams {
  const o = isRecord(v) ? v : {};
  if (!isRecord(v)) warnings.push("missing params, using defaults");
  let method = DEFAULTS.method;
  if (isDitherMethod(o.method)) {
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
  let colorMode: ColorMode | undefined;
  if (o.colorMode === "palette" || o.colorMode === "original") {
    colorMode = o.colorMode;
  } else if (o.colorMode !== undefined) {
    warnings.push(`unknown colorMode "${String(o.colorMode)}", using palette`);
  }
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
  return {
    method,
    threshold,
    palette: parsePalette(o.palette, warnings),
    color,
    // Omitted rather than written as "palette", so a preset that never chose a
    // mode round-trips byte-for-byte as it did before.
    ...(colorMode ? { colorMode } : {}),
    pixelSize,
  };
}

/** Read the optional operation set; junk falls back to identity with a warning. */
function parseOperations(v: unknown, warnings: string[]): ImageOperations | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) {
    warnings.push("invalid operations, ignoring");
    return undefined;
  }
  const operations = sanitizeOperations(v);
  if (isIdentity(operations) && Object.keys(v).length > 0) {
    warnings.push("no usable operations, ignoring");
  }
  return isIdentity(operations) ? undefined : operations;
}

/** Parse preset JSON text. Returns null preset only for non-object input. */
export function parsePresetJson(text: string, nameHint?: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { preset: null, warnings: ["not valid JSON"] };
  }
  if (!isRecord(raw)) return { preset: null, warnings: ["preset must be an object"] };
  if (isLegacyPreset(raw)) return migrateLegacyPreset(raw, nameHint);
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
  const operations = parseOperations(raw.operations, warnings);
  const preset: Preset = { version: PRESET_VERSION, name, params, effects };
  if (operations) preset.operations = operations;
  return { preset, warnings };
}

/** Serialize a preset to canonical JSON; identity operations stay out. */
export function serializePreset(preset: Preset): string {
  return JSON.stringify(
    {
      version: PRESET_VERSION,
      name: preset.name,
      params: preset.params,
      effects: preset.effects,
      operations:
        preset.operations && !isIdentity(preset.operations) ? preset.operations : undefined,
    },
    null,
    2,
  );
}
