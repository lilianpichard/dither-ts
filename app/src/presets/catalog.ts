// The 13 originals from the Dither Guy repo ship with the app as verbatim
// legacy JSON, loaded through the same migration path as a hand-picked file.
// Nothing outside the bundle is read at runtime.

import { parsePresetJson } from "./schema";
import type { ParseResult, Preset } from "./schema";

const RAW = import.meta.glob("./catalog/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface CatalogEntry {
  /** Preset name, taken from the file stem so the 13 stay recognisable. */
  name: string;
  json: string;
}

function fileStem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** Every bundled preset file, name-sorted for a stable gallery order. */
export function catalogEntries(): CatalogEntry[] {
  return Object.entries(RAW)
    .map(([path, json]) => ({ name: fileStem(path), json }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parse one bundled entry through the normal import path. */
export function parseCatalogEntry(entry: CatalogEntry): ParseResult {
  return parsePresetJson(entry.json, entry.name);
}

/** Bundled presets that survived migration, with every warning attached. */
export function loadCatalog(): { preset: Preset; warnings: string[] }[] {
  return catalogEntries().flatMap((entry) => {
    const { preset, warnings } = parseCatalogEntry(entry);
    return preset ? [{ preset, warnings }] : [];
  });
}
