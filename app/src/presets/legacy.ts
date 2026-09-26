// Legacy Dither Guy presets are flat snake_case JSON; preset v1 nests everything
// under params/effects/operations. Migration maps what has an equivalent and
// reports every field it cannot carry, so nothing disappears silently. A field
// the file omits is not a problem and stays quiet; a field it supplies but
// cannot be used always gets a warning.

import { METHOD_NAMES, PALETTES } from "../../../src/index.js";
import type { DitherMethod, RGB } from "../../../src/index.js";
import { sanitizeOperations } from "../image/settings";
import type { ImageOperations } from "../image/ops";
import type { ParseResult, Preset, PresetEffect } from "./schema";
import { PRESET_VERSION } from "./version";

/** Fields only the flat legacy format spells this way. */
const LEGACY_ONLY = new Set([
  "pixel_size",
  "palette_name",
  "custom_palette",
  "hue_rotate",
  "blur",
  "sharpen",
  "glow_radius",
  "glow_intensity",
  "pre_denoise",
  "pre_smooth",
  "post_denoise",
  "post_smooth",
]);

/**
 * Fields both formats spell the same way. At the top level they only ever mean
 * legacy, because v1 keeps them under params, so a minimal preset carrying just
 * these is still recognisable.
 */
const SHARED_NAMES: readonly string[] = [
  "method",
  "threshold",
  "brightness",
  "contrast",
  "saturation",
  "color",
];

/** Every field a legacy preset may carry, so nothing is left unclaimed. */
const LEGACY_FIELDS = new Set<string>([...LEGACY_ONLY, ...SHARED_NAMES, "name"]);

const DEFAULT_METHOD = "Floyd-Steinberg";
const DEFAULT_THRESHOLD = 128;
const DEFAULT_PIXEL_SIZE = 1;
/** Legacy smooth strength 1-5 maps to a gaussian radius of strength * 0.5. */
const SMOOTH_TO_RADIUS = 0.5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDitherMethod(value: unknown): value is DitherMethod {
  return typeof value === "string" && (METHOD_NAMES as readonly string[]).includes(value);
}

function isRGB(value: unknown): value is RGB {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255)
  );
}

/** Render a rejected value so the warning names what was actually in the file. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  return String(value);
}

/**
 * Read an optional numeric field. Absent returns undefined in silence; present
 * but not a finite number warns and is treated as absent, so a malformed value
 * is never mistaken for an omitted one.
 */
function num(
  raw: Record<string, unknown>,
  key: string,
  warnings: string[],
  complaint = "is not a number, ignored",
): number | undefined {
  if (!Object.hasOwn(raw, key)) return undefined;
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  warnings.push(`${key} ${describe(value)} ${complaint}`);
  return undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * True for the flat legacy shape, minimal or not. A v1 payload is excluded even
 * when junk keys ride along with it, so the v1 parser keeps reporting those.
 */
export function isLegacyPreset(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version !== undefined || value.params !== undefined || value.effects !== undefined) {
    return false;
  }
  return Object.keys(value).some((key) => LEGACY_ONLY.has(key) || SHARED_NAMES.includes(key));
}

/** Legacy palette names are matched case-insensitively; dither-ts keys win. */
function matchPalette(name: string): string | null {
  if (Object.hasOwn(PALETTES, name)) return name;
  const lower = name.toLowerCase();
  const found = Object.keys(PALETTES).find((key) => key.toLowerCase() === lower);
  return found ?? null;
}

function legacyPalette(
  raw: Record<string, unknown>,
  warnings: string[],
): Preset["params"]["palette"] {
  const custom = raw.custom_palette;
  // Dither Guy writes null to mean "no custom palette", which is not an error.
  if (custom !== undefined && custom !== null) {
    if (!Array.isArray(custom)) {
      warnings.push("custom_palette is not a list, ignoring");
    } else {
      const colors = custom.filter(isRGB) as RGB[];
      if (colors.length !== custom.length) {
        warnings.push(`custom_palette: dropped ${custom.length - colors.length} invalid colors`);
      }
      if (colors.length >= 2 && colors.length <= 16) return { custom: colors };
      // Dither Guy also falls back to the named palette here, not to B&W.
      warnings.push(`custom_palette has ${colors.length} colors, needs 2-16, using palette_name`);
    }
  }
  if (!Object.hasOwn(raw, "palette_name")) return "B&W";
  const name = raw.palette_name;
  if (typeof name !== "string") {
    warnings.push(`palette_name ${describe(name)} is not a string, using B&W`);
    return "B&W";
  }
  const matched = matchPalette(name);
  if (matched) {
    if (matched !== name) warnings.push(`palette_name "${name}" renamed to "${matched}"`);
    return matched;
  }
  warnings.push(`palette_name "${name}" is not a dither-ts palette, using B&W`);
  return "B&W";
}

function legacyMethod(raw: Record<string, unknown>, warnings: string[]): DitherMethod {
  if (isDitherMethod(raw.method)) return raw.method;
  if (Object.hasOwn(raw, "method")) {
    warnings.push(
      `method ${describe(raw.method)} is not a dither-ts method, using ${DEFAULT_METHOD}`,
    );
  }
  return DEFAULT_METHOD;
}

function legacyThreshold(raw: Record<string, unknown>, warnings: string[]): number {
  const complaint = `is not a number, using ${DEFAULT_THRESHOLD}`;
  const value = num(raw, "threshold", warnings, complaint);
  if (value === undefined) return DEFAULT_THRESHOLD;
  if (value < 1 || value > 254) {
    warnings.push(`threshold ${value} is out of range 1-254, using ${DEFAULT_THRESHOLD}`);
    return DEFAULT_THRESHOLD;
  }
  return Math.round(value);
}

function legacyPixelSize(raw: Record<string, unknown>, warnings: string[]): number {
  const complaint = `is not a number, using ${DEFAULT_PIXEL_SIZE}`;
  const value = num(raw, "pixel_size", warnings, complaint);
  if (value === undefined) return DEFAULT_PIXEL_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    warnings.push(`pixel_size ${value} is not a whole 1-8, using ${DEFAULT_PIXEL_SIZE}`);
    return DEFAULT_PIXEL_SIZE;
  }
  return value;
}

/** Legacy brightness/contrast/saturation are 1.0-centred multipliers; dither-ts is a delta. */
function legacyAdjustment(
  key: string,
  raw: Record<string, unknown>,
  warnings: string[],
): number | undefined {
  const value = num(raw, key, warnings);
  if (value === undefined) return undefined;
  const delta = value - 1;
  if (delta < -1 || delta > 1) {
    warnings.push(`${key} ${value} is out of range 0-2, clamped`);
  }
  return round2(Math.min(1, Math.max(-1, delta)));
}

/** Legacy hue_rotate is 0-360; dither-ts operations take -180..180. */
function legacyHue(raw: Record<string, unknown>, warnings: string[]): number | undefined {
  const value = num(raw, "hue_rotate", warnings);
  if (value === undefined) return undefined;
  const wrapped = (((value % 360) + 540) % 360) - 180;
  if (wrapped !== value) {
    warnings.push(`hue_rotate ${value} wrapped to ${wrapped} degrees`);
  }
  return wrapped === 0 ? undefined : Math.round(wrapped);
}

function legacyOperations(raw: Record<string, unknown>, warnings: string[]): ImageOperations {
  const candidate: Record<string, unknown> = {};
  for (const key of ["brightness", "contrast", "saturation"] as const) {
    const value = legacyAdjustment(key, raw, warnings);
    if (value !== undefined) candidate[key] = value;
  }
  const hue = legacyHue(raw, warnings);
  if (hue !== undefined) candidate.hue = hue;
  return sanitizeOperations(candidate);
}

/** Legacy blur/sharpen ran before dithering; dither-ts only has them as post effects. */
function legacyEffects(raw: Record<string, unknown>, warnings: string[]): PresetEffect[] {
  const effects: PresetEffect[] = [];
  const add = (type: string, params: Record<string, number>): void => {
    effects.push({ type, params, enabled: true });
  };
  // Legacy blur and sharpen are pre-dither filters, so say where they landed.
  const blur = num(raw, "blur", warnings);
  if (blur !== undefined && blur > 0) {
    add("blur", { radius: blur });
    warnings.push("blur ran before dithering, now applied after it");
  } else if (blur !== undefined && blur < 0) {
    warnings.push(`blur ${blur} is negative, ignored`);
  }
  const sharpen = num(raw, "sharpen", warnings);
  if (sharpen !== undefined && sharpen > 0) {
    add("sharpen", { amount: sharpen });
    warnings.push("sharpen ran before dithering, now applied after it");
  } else if (sharpen !== undefined && sharpen < 0) {
    warnings.push(`sharpen ${sharpen} is negative, ignored`);
  }
  const glowRadius = num(raw, "glow_radius", warnings);
  const glowIntensity = num(raw, "glow_intensity", warnings);
  if (glowRadius !== undefined && glowRadius < 0) {
    warnings.push(`glow_radius ${glowRadius} is negative, ignored`);
  } else if (glowRadius !== undefined && glowRadius > 0) {
    add("glow", { radius: glowRadius, intensity: glowIntensity ?? 30 });
  } else if (glowIntensity !== undefined && glowIntensity > 0) {
    // Nothing to act on without a radius, so the setting is simply lost.
    warnings.push(`glow_intensity ${glowIntensity} has no glow_radius to act on, ignored`);
  }
  // Legacy post_smooth is a gaussian of strength * 0.5, which the blur effect is.
  const postSmooth = num(raw, "post_smooth", warnings);
  if (postSmooth !== undefined && postSmooth > 0) {
    add("blur", { radius: postSmooth * SMOOTH_TO_RADIUS });
  } else if (postSmooth !== undefined && postSmooth < 0) {
    warnings.push(`post_smooth ${postSmooth} is negative, ignored`);
  }
  return effects;
}

/** Settings dither-ts has no home for, and keys it does not recognise at all. */
function legacyDropped(raw: Record<string, unknown>, warnings: string[]): void {
  if (isRGB(raw.color)) {
    warnings.push(
      `replacement color [${raw.color.join(", ")}] is not supported: dither-ts cannot recolor dithered output`,
    );
  } else if (Object.hasOwn(raw, "color") && raw.color !== null) {
    warnings.push(`replacement color ${describe(raw.color)} is not an RGB triple, ignored`);
  }
  for (const [key, what, why] of [
    ["pre_denoise", "median denoise before dithering", "dither-ts has no median filter"],
    ["post_denoise", "median denoise after dithering", "dither-ts has no median filter"],
    ["pre_smooth", "gaussian smooth before dithering", "dither-ts blurs only after dithering"],
  ] as const) {
    const value = num(raw, key, warnings);
    if (value === undefined || value === 0) continue;
    warnings.push(`${key} ${value} (${what}) is not supported: ${why}`);
  }
  for (const key of Object.keys(raw)) {
    if (!LEGACY_FIELDS.has(key)) warnings.push(`ignoring unknown legacy field "${key}"`);
  }
}

function legacyName(raw: Record<string, unknown>, nameHint?: string): string {
  if (typeof raw.name === "string" && raw.name.trim().length > 0) return raw.name.trim();
  if (nameHint && nameHint.trim().length > 0) return nameHint.trim();
  return "Untitled";
}

/** Convert one legacy preset object into a v1 preset plus every migration warning. */
export function migrateLegacyPreset(raw: Record<string, unknown>, nameHint?: string): ParseResult {
  const warnings = ["legacy Dither Guy preset, migrated"];
  const operations = legacyOperations(raw, warnings);
  const preset: Preset = {
    version: PRESET_VERSION,
    name: legacyName(raw, nameHint),
    params: {
      method: legacyMethod(raw, warnings),
      threshold: legacyThreshold(raw, warnings),
      palette: legacyPalette(raw, warnings),
      // Legacy `color` is a replacement colour, not a mode; v1 starts in B&W.
      color: false,
      pixelSize: legacyPixelSize(raw, warnings),
    },
    effects: legacyEffects(raw, warnings),
  };
  if (Object.keys(operations).length > 0) preset.operations = operations;
  legacyDropped(raw, warnings);
  return { preset, warnings };
}
