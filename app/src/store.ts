import { create } from "zustand";
import type { DitherMethod, EffectInstance, RGB } from "../../src/index.js";
import { defaultEffectParams } from "../../src/index.js";
import {
  EMPTY_HISTORY,
  commitHistory,
  redoHistory,
  undoHistory,
  type HistoryEntry,
  type HistoryState,
} from "./history";
import { IDENTITY_OPERATIONS, fitOperations } from "./image/settings";
import type { ImageOperations } from "./image/ops";

export interface DitherParams {
  method: DitherMethod;
  threshold: number;
  palette: string | RGB[];
  color: boolean;
  pixelSize: number;
}

export interface ImageSource {
  width: number;
  height: number;
  pixels: ArrayBuffer;
  name: string;
}

export interface RenderResult {
  width: number;
  height: number;
  pixels: ArrayBuffer;
  ms: number;
  jobId: number;
  partial?: boolean;
}

interface AppState {
  source: ImageSource | null;
  params: DitherParams;
  effects: StackedEffect[];
  /** Pre-dither geometry and colour operations; identity by default. */
  operations: ImageOperations;
  result: RenderResult | null;
  preview: RenderResult | null;
  rendering: boolean;
  previewScaled: boolean;
  /** Bounded undo/redo stacks over params plus operations. */
  past: HistoryEntry[];
  future: HistoryEntry[];
  setSource: (source: ImageSource | null) => void;
  /** Params are merged; a given `operations` set replaces the current one. */
  setParams: (params: Partial<DitherParams>, operations?: Partial<ImageOperations>) => void;
  /** Patch the operation set, leaving untouched fields alone. */
  setOperations: (operations: Partial<ImageOperations>) => void;
  resetOperations: () => void;
  undo: () => void;
  redo: () => void;
  setResult: (result: RenderResult | null) => void;
  setPreview: (preview: RenderResult | null) => void;
  setRendering: (rendering: boolean) => void;
  setPreviewScaled: (previewScaled: boolean) => void;
  setEffects: (effects: StackedEffect[]) => void;
  addEffect: (type: string) => void;
  removeEffect: (index: number) => void;
  moveEffect: (index: number, direction: -1 | 1) => void;
  toggleEffect: (index: number) => void;
  setEffectParam: (index: number, key: string, value: number) => void;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export interface StackedEffect extends EffectInstance {
  key: string;
}

type HistorySlice = Pick<AppState, "params" | "operations" | "past" | "future">;

function historyOf(state: HistorySlice): HistoryState {
  return { past: state.past, future: state.future };
}

function currentOf(state: HistorySlice): HistoryEntry {
  return { params: state.params, operations: state.operations };
}

// Only the crop depends on the frame: it must fit whatever source is current,
// however it got here. A new source, a preset, an operation patch, or an undo
// landing a snapshot taken against a larger frame all go through here.
function fitToSource(source: ImageSource | null, operations: unknown): ImageOperations {
  return fitOperations(operations, source?.width ?? 0, source?.height ?? 0);
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
  operations: IDENTITY_OPERATIONS,
  result: null,
  preview: null,
  rendering: false,
  previewScaled: false,
  past: EMPTY_HISTORY.past,
  future: EMPTY_HISTORY.future,
  setSource: (source) =>
    set((state) => ({
      source,
      // A crop belongs to the frame it was cut from, so the badge must follow.
      operations: fitToSource(source, state.operations),
      result: null,
      preview: null,
      rendering: false,
      previewScaled: false,
    })),
  setParams: (params, operations) =>
    set((state) => {
      const nextParams = { ...state.params, ...params };
      // A second argument replaces the whole operation set, so applying a
      // preset without operations clears the previous ones.
      const nextOperations =
        operations === undefined ? state.operations : fitToSource(state.source, operations);
      return {
        params: nextParams,
        operations: nextOperations,
        result: null,
        ...commitHistory(historyOf(state), currentOf(state), {
          params: nextParams,
          operations: nextOperations,
        }),
      };
    }),
  setOperations: (operations) =>
    set((state) => {
      const next = fitToSource(state.source, { ...state.operations, ...operations });
      return {
        operations: next,
        result: null,
        ...commitHistory(historyOf(state), currentOf(state), {
          params: state.params,
          operations: next,
        }),
      };
    }),
  resetOperations: () =>
    set((state) => ({
      operations: IDENTITY_OPERATIONS,
      result: null,
      ...commitHistory(historyOf(state), currentOf(state), {
        params: state.params,
        operations: IDENTITY_OPERATIONS,
      }),
    })),
  undo: () =>
    set((state) => {
      const step = undoHistory(historyOf(state), currentOf(state));
      if (!step.entry) return state;
      return {
        ...step.history,
        params: step.entry.params,
        operations: fitToSource(state.source, step.entry.operations),
        result: null,
      };
    }),
  redo: () =>
    set((state) => {
      const step = redoHistory(historyOf(state), currentOf(state));
      if (!step.entry) return state;
      return {
        ...step.history,
        params: step.entry.params,
        operations: fitToSource(state.source, step.entry.operations),
        result: null,
      };
    }),
  setResult: (result) => set({ result, preview: null, rendering: false }),
  setPreview: (preview) => set({ preview }),
  setRendering: (rendering) => set({ rendering }),
  setPreviewScaled: (previewScaled) => set({ previewScaled }),
  setEffects: (effects) => set({ effects, result: null }),
  addEffect: (type) =>
    set((state) => ({
      effects: [
        ...state.effects,
        { key: uid(), type, params: defaultEffectParams(type), enabled: true },
      ],
      result: null,
    })),
  removeEffect: (index) =>
    set((state) => ({
      effects: state.effects.filter((_, i) => i !== index),
      result: null,
    })),
  moveEffect: (index, direction) =>
    set((state) => {
      const next = [...state.effects];
      const target = index + direction;
      if (target < 0 || target >= next.length) return state;
      [next[index], next[target]] = [next[target], next[index]];
      return { effects: next, result: null };
    }),
  toggleEffect: (index) =>
    set((state) => ({
      effects: state.effects.map((effect, i) =>
        i === index ? { ...effect, enabled: !effect.enabled } : effect,
      ),
      result: null,
    })),
  setEffectParam: (index, key, value) =>
    set((state) => ({
      effects: state.effects.map((effect, i) =>
        i === index ? { ...effect, params: { ...effect.params, [key]: value } } : effect,
      ),
      result: null,
    })),
}));
