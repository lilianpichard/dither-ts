import { create } from "zustand";
import { toast } from "sonner";
import { parsePresetJson, serializePreset, type Preset, type PresetEffect } from "./schema";
import { PRESET_VERSION } from "./version";
import { loadCatalog } from "./catalog";
import { useApp, type DitherParams, type StackedEffect } from "../store";
import { sanitizeOperations } from "../image/settings";
import type { ImageOperations } from "../image/ops";

export interface SavedPreset {
  id: string;
  favorite: boolean;
  preset: Preset;
  /** Epoch ms the entry was added; absent on galleries saved before this field. */
  createdAt?: number;
}

/** Result of adding presets from JSON: what landed, and every warning raised. */
export interface ImportResult {
  added: number;
  warnings: string[];
}

interface PresetStore {
  items: SavedPreset[];
  load: () => void;
  saveCurrent: (name: string, params: DitherParams) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  toggleFavorite: (id: string) => void;
  duplicate: (id: string) => void;
  importJson: (text: string, nameHint?: string) => ImportResult;
  /** Add any bundled preset whose name is not in the gallery yet. */
  installCatalog: () => ImportResult;
  exportJson: (id: string) => string | null;
}

const STORAGE_KEY = "dither-ts.presets.v1";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Accepts a finite epoch only, so a tampered entry cannot render "Invalid Date". */
function readCreatedAt(entry: unknown): number | undefined {
  const value = (entry as { createdAt?: unknown } | null)?.createdAt;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

// A silent quota failure looks like a save that worked right up to the next
// reload, so it is reported once and again only after it recovers.
let persistComplained = false;

function persist(items: SavedPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    persistComplained = false;
  } catch {
    // Storage full or unavailable: presets stay in memory only.
    if (persistComplained) return;
    persistComplained = true;
    toast.error(
      "Presets could not be saved. Browser storage is full or blocked, so they last for this session only.",
    );
  }
}

export function presetToParams(preset: Preset): DitherParams {
  const p = preset.params;
  return {
    method: p.method,
    threshold: p.threshold,
    palette: typeof p.palette === "string" ? p.palette : p.palette.custom,
    color: p.color,
    // Kept only when the preset carries it, so a preset written before the
    // field existed still means "palette" through resolveColorMode.
    ...(p.colorMode ? { colorMode: p.colorMode } : {}),
    pixelSize: p.pixelSize,
  };
}

export function paramsToPreset(
  name: string,
  params: DitherParams,
  effects: PresetEffect[],
  operations: ImageOperations = {},
): Preset {
  return {
    version: PRESET_VERSION,
    name,
    params: {
      method: params.method,
      threshold: params.threshold,
      palette: typeof params.palette === "string" ? params.palette : { custom: params.palette },
      color: params.color,
      // Without this, saving a preset set to Original and applying it put the
      // app back on Palette, because the schema supported the field and the
      // round trip dropped it.
      ...(params.colorMode ? { colorMode: params.colorMode } : {}),
      pixelSize: params.pixelSize,
    },
    effects: effects.map((e) => ({ type: e.type, params: { ...e.params }, enabled: e.enabled })),
    operations: sanitizeOperations(operations),
  };
}

/** Apply a preset: params, a replaced operation set, and a freshly-keyed stack. */
export function applyPreset(preset: Preset): void {
  const { setParams, setEffects } = useApp.getState();
  setParams(presetToParams(preset), preset.operations ?? {});
  setEffects(
    preset.effects.map((e) => ({
      key: uid(),
      type: e.type,
      params: { ...e.params },
      enabled: e.enabled,
    })),
  );
}

/** Strip UI keys for worker/preset payloads. */
export function stripKeys(effects: StackedEffect[]): PresetEffect[] {
  return effects.map((e) => ({ type: e.type, params: { ...e.params }, enabled: e.enabled }));
}

export const usePresets = create<PresetStore>()((set, get) => ({
  items: [],
  load: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const items: SavedPreset[] = [];
      for (const entry of parsed) {
        if (typeof entry !== "object" || entry === null) continue;
        const { preset } = parsePresetJson(JSON.stringify((entry as { preset: unknown }).preset));
        if (!preset) continue;
        items.push({
          id:
            typeof (entry as { id: unknown }).id === "string"
              ? (entry as { id: string }).id
              : uid(),
          favorite: (entry as { favorite: unknown }).favorite === true,
          preset,
          createdAt: readCreatedAt(entry),
        });
      }
      set({ items });
    } catch {
      // Corrupt storage: start empty, never crash.
    }
  },
  saveCurrent: (name, params) => {
    const { effects, operations } = useApp.getState();
    const items = [
      ...get().items,
      {
        id: uid(),
        favorite: false,
        preset: paramsToPreset(name, params, stripKeys(effects), operations),
        createdAt: Date.now(),
      },
    ];
    persist(items);
    set({ items });
  },
  remove: (id) => {
    const items = get().items.filter((i) => i.id !== id);
    persist(items);
    set({ items });
  },
  rename: (id, name) => {
    const items = get().items.map((i) =>
      i.id === id ? { ...i, preset: { ...i.preset, name } } : i,
    );
    persist(items);
    set({ items });
  },
  toggleFavorite: (id) => {
    const items = get().items.map((i) => (i.id === id ? { ...i, favorite: !i.favorite } : i));
    persist(items);
    set({ items });
  },
  duplicate: (id) => {
    const found = get().items.find((i) => i.id === id);
    if (!found) return;
    const items = [
      ...get().items,
      {
        id: uid(),
        favorite: false,
        preset: { ...found.preset, name: `${found.preset.name} copy` },
        createdAt: Date.now(),
      },
    ];
    persist(items);
    set({ items });
  },
  importJson: (text, nameHint) => {
    const { preset, warnings } = parsePresetJson(text, nameHint);
    if (!preset) return { added: 0, warnings };
    const items = [...get().items, { id: uid(), favorite: false, preset, createdAt: Date.now() }];
    persist(items);
    set({ items });
    return { added: 1, warnings };
  },
  installCatalog: () => {
    const existing = new Set(get().items.map((item) => item.preset.name));
    const warnings: string[] = [];
    const fresh: SavedPreset[] = [];
    for (const { preset, warnings: entryWarnings } of loadCatalog()) {
      if (existing.has(preset.name)) continue;
      existing.add(preset.name);
      fresh.push({ id: uid(), favorite: false, preset, createdAt: Date.now() });
      warnings.push(...entryWarnings);
    }
    if (fresh.length > 0) {
      const items = [...get().items, ...fresh];
      persist(items);
      set({ items });
    }
    return { added: fresh.length, warnings };
  },
  exportJson: (id) => {
    const found = get().items.find((i) => i.id === id);
    return found ? serializePreset(found.preset) : null;
  },
}));
