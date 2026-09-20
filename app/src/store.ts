import { create } from "zustand";
import type { RGB } from "../../src/index.js";

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
  result: RenderResult | null;
  rendering: boolean;
  setSource: (s: ImageSource | null) => void;
  setParams: (p: Partial<DitherParams>) => void;
  setResult: (r: RenderResult | null) => void;
  setRendering: (b: boolean) => void;
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
  result: null,
  rendering: false,
  setSource: (source) => set({ source, result: null }),
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setResult: (result) => set({ result, rendering: false }),
  setRendering: (rendering) => set({ rendering }),
}));
