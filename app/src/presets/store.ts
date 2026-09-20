import { create } from "zustand";
import { parsePresetJson, serializePreset, type Preset } from "./schema";
import type { DitherParams } from "../store";

export interface SavedPreset {
  id: string;
  favorite: boolean;
  preset: Preset;
}

interface PresetStore {
  items: SavedPreset[];
  load: () => void;
  saveCurrent: (name: string, params: DitherParams) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  toggleFavorite: (id: string) => void;
  duplicate: (id: string) => void;
  importJson: (text: string) => { ok: boolean; warnings: string[] };
  exportJson: (id: string) => string | null;
}

const STORAGE_KEY = "dither-ts.presets.v1";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function persist(items: SavedPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or unavailable: presets stay in memory only.
  }
}

export function presetToParams(preset: Preset): DitherParams {
  const p = preset.params;
  return {
    method: p.method,
    threshold: p.threshold,
    palette: typeof p.palette === "string" ? p.palette : p.palette.custom,
    color: p.color,
    pixelSize: p.pixelSize,
  };
}

export function paramsToPreset(name: string, params: DitherParams): Preset {
  return {
    version: 1,
    name,
    params: {
      method: params.method,
      threshold: params.threshold,
      palette: typeof params.palette === "string" ? params.palette : { custom: params.palette },
      color: params.color,
      pixelSize: params.pixelSize,
    },
    effects: [],
  };
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
        });
      }
      set({ items });
    } catch {
      // Corrupt storage: start empty, never crash.
    }
  },
  saveCurrent: (name, params) => {
    const items = [
      ...get().items,
      { id: uid(), favorite: false, preset: paramsToPreset(name, params) },
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
      },
    ];
    persist(items);
    set({ items });
  },
  importJson: (text) => {
    const { preset, warnings } = parsePresetJson(text);
    if (!preset) return { ok: false, warnings };
    const items = [...get().items, { id: uid(), favorite: false, preset }];
    persist(items);
    set({ items });
    return { ok: true, warnings };
  },
  exportJson: (id) => {
    const found = get().items.find((i) => i.id === id);
    return found ? serializePreset(found.preset) : null;
  },
}));
