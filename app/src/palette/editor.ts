// Custom palette editing: hex in, RGB out, always inside the 2..16 window the
// preset format and the color ditherer both expect. Every helper is pure so
// the editor can stay a thin view over the active palette.

import { PALETTES, type RGB } from "../../../src/index.js";

export const MIN_PALETTE_COLORS = 2;
export const MAX_PALETTE_COLORS = 16;

/** Starter swatches for a palette that does not exist yet. */
export const DEFAULT_CUSTOM_COLORS: RGB[] = [
  [0, 0, 0],
  [255, 255, 255],
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * True only for a palette that is really in the table. The name can come from a
 * preset file, so a key like `constructor` must not resolve through the
 * prototype chain and be handed back as if it were a colour list.
 */
function hasPalette(name: string): boolean {
  return Object.hasOwn(PALETTES, name);
}

export function isCustomPalette(palette: string | RGB[]): palette is RGB[] {
  return Array.isArray(palette);
}

/** Lowercase `#rrggbb`, expanding `#abc`; null when the text is not a hex colour. */
export function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  return `#${full}`;
}

export function hexToRgb(value: string): RGB | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

export function rgbToHex(color: RGB): string {
  return `#${color
    .map((c) =>
      Math.min(255, Math.max(0, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function colorsEqual(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The colours in use: a custom list as typed, or a built-in palette. */
export function activeColors(palette: string | RGB[]): RGB[] {
  if (isCustomPalette(palette)) return palette;
  return hasPalette(palette) ? PALETTES[palette] : [];
}

/** Editing draft for a palette: the live list, or a copy of the built-in one. */
export function draftColors(palette: string | RGB[]): RGB[] {
  if (isCustomPalette(palette)) return [...palette];
  const named = hasPalette(palette) ? PALETTES[palette] : undefined;
  return named ? named.slice(0, MAX_PALETTE_COLORS) : [...DEFAULT_CUSTOM_COLORS];
}

/** Append a colour; invalid, duplicate, or over-long lists are left alone. */
export function addColor(colors: RGB[], value: string): RGB[] {
  const rgb = hexToRgb(value);
  if (!rgb || colors.length >= MAX_PALETTE_COLORS) return colors;
  if (colors.some((c) => colorsEqual(c, rgb))) return colors;
  return [...colors, rgb];
}

/** Drop a colour, but never below the two-colour minimum. */
export function removeColor(colors: RGB[], index: number): RGB[] {
  if (index < 0 || index >= colors.length || colors.length <= MIN_PALETTE_COLORS) return colors;
  return colors.filter((_, i) => i !== index);
}

/** Replace one colour in place; an invalid hex leaves the list untouched. */
export function editColor(colors: RGB[], index: number, value: string): RGB[] {
  const rgb = hexToRgb(value);
  if (!rgb || index < 0 || index >= colors.length) return colors;
  return colors.map((c, i) => (i === index ? rgb : c));
}

/** True when the active palette already is this list, swatch order included. */
export function isActivePalette(palette: string | RGB[], colors: RGB[]): boolean {
  if (!isCustomPalette(palette)) return false;
  return palette.length === colors.length && palette.every((c, i) => colorsEqual(c, colors[i]));
}
