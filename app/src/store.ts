import { create } from "zustand";
import type { EffectInstance, RGB } from "../../src/index.js";
import { defaultEffectParams } from "../../src/index.js";

export interface DitherParams {
  method: string;
  threshold: number;
  palette: string | RGB[];
  color: boolean;
  pixelSize: number;
}

export interface ImageSource {
  width: number;
  height: number;
  pixels: ArrayBuffer; // RGBA
  name: string;
}

export interface RenderResult {
  width: number;
  height: number;
  pixels: ArrayBuffer; // RGBA
  ms: number;
  jobId: number;
}

interface AppState {
  source: ImageSource | null;
  params: DitherParams;
  effects: StackedEffect[];
  result: RenderResult | null;
  rendering: boolean;
  setSource: (s: ImageSource | null) => void;
  setParams: (p: Partial<DitherParams>) => void;
  setResult: (r: RenderResult | null) => void;
  setRendering: (b: boolean) => void;
  setEffects: (e: StackedEffect[]) => void;
  addEffect: (type: string) => void;
  removeEffect: (index: number) => void;
  moveEffect: (index: number, dir: -1 | 1) => void;
  toggleEffect: (index: number) => void;
  setEffectParam: (index: number, key: string, value: number) => void;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface StackedEffect extends EffectInstance {
  key: string;
}

export const useApp = create<AppState>()((set) => ({
  source: null,
  params: {
    method: "Floyd-Steinberg",
    threshold: 128,
    palette: "GameBoy",
    color: false,
    pixelSize: 1,
  },
  effects: [],
  result: null,
  rendering: false,
  setSource: (source) => set({ source, result: null }),
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setResult: (result) => set({ result, rendering: false }),
  setRendering: (rendering) => set({ rendering }),
  setEffects: (effects) => set({ effects }),
  addEffect: (type) =>
    set((s) => ({
      effects: [
        ...s.effects,
        { key: uid(), type, params: defaultEffectParams(type), enabled: true },
      ],
    })),
  removeEffect: (index) => set((s) => ({ effects: s.effects.filter((_, i) => i !== index) })),
  moveEffect: (index, dir) =>
    set((s) => {
      const next = [...s.effects];
      const j = index + dir;
      if (j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j], next[index]];
      return { effects: next };
    }),
  toggleEffect: (index) =>
    set((s) => ({
      effects: s.effects.map((e, i) => (i === index ? { ...e, enabled: !e.enabled } : e)),
    })),
  setEffectParam: (index, key, value) =>
    set((s) => ({
      effects: s.effects.map((e, i) =>
        i === index ? { ...e, params: { ...e.params, [key]: value } } : e,
      ),
    })),
}));
