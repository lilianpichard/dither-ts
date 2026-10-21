import { create } from "zustand";
import type { ColorMode, DitherMethod, EffectInstance, RGB } from "../../src/index.js";
import { defaultEffectParams, supportsColor } from "../../src/index.js";
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
import type { Frame } from "./preview/frame";

export interface DitherParams {
  method: DitherMethod;
  threshold: number;
  palette: string | RGB[];
  color: boolean;
  /** Absent means "palette", which is what every preset written earlier meant. */
  colorMode?: ColorMode;
  pixelSize: number;
}

/**
 * The colour mode a render request should carry. Every render path resolves it
 * through here, so a preset written before the field existed (and therefore
 * has no `colorMode`) means "palette" in exactly one place.
 */
export function resolveColorMode(params: Pick<DitherParams, "colorMode">): ColorMode {
  return params.colorMode === "original" ? "original" : "palette";
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

/**
 * What the video timeline publishes for the shared preview surface: the dithered
 * frame, the decoded frame to compare against, and the clip-space geometry the
 * view is expressed in. `clipKey` changes only when a different clip is loaded,
 * so the surface can tell "new subject" from "next frame".
 */
export interface VideoPreview {
  display: Frame;
  compare: Frame;
  geometry: Frame;
  clipKey: string;
}

interface AppState {
  /** Which source owns the canvas, so the two can never both be live. */
  media: "image" | "video" | null;
  source: ImageSource | null;
  params: DitherParams;
  effects: StackedEffect[];
  /** Pre-dither geometry and colour operations; identity by default. */
  operations: ImageOperations;
  result: RenderResult | null;
  preview: RenderResult | null;
  /**
   * The video timeline's current frame, published so the main canvas can preview
   * it exactly like a still image. `null` whenever no video owns the canvas.
   */
  videoPreview: VideoPreview | null;
  rendering: boolean;
  previewScaled: boolean;
  /** Bounded undo/redo stacks over params plus operations. */
  past: HistoryEntry[];
  future: HistoryEntry[];
  setSource: (source: ImageSource | null) => void;
  /**
   * Take the canvas for a video. The still is dropped, so an image and a clip
   * can never both be live: whichever the user loaded last is the subject, and
   * clicking away from the video panel cannot hand it back.
   */
  showVideo: (videoPreview: VideoPreview | null) => void;
  setRendering: (rendering: boolean) => void;
  /**
   * Load generation shared by image and video decodes. A decode may only
   * publish when its token is still current, so the last file picked wins even
   * when an earlier decode finishes last.
   */
  mediaSeq: number;
  beginMediaLoad: () => number;
  /** A file the shared picker routed to the video panel, waiting to load. */
  pendingVideo: { file: File; seq: number } | null;
  loadVideo: (file: File | null, seq?: number) => void;
  /**
   * Bumped whenever the loaded media is dropped, so the timeline can throw the
   * clip away without the store having to reach into it. The canvas owner lives
   * in the store; the clip itself lives in the timeline.
   */
  clearSeq: number;
  clearMedia: () => void;
  /**
   * Params are merged; a given `operations` set replaces the current one, and
   * a given effect stack replaces the current one in the same history step.
   */
  setParams: (
    params: Partial<DitherParams>,
    operations?: Partial<ImageOperations>,
    effects?: StackedEffect[],
  ) => void;
  /** Patch the operation set, leaving untouched fields alone. */
  setOperations: (operations: Partial<ImageOperations>) => void;
  resetOperations: () => void;
  undo: () => void;
  redo: () => void;
  setResult: (result: RenderResult | null) => void;
  setPreview: (preview: RenderResult | null) => void;
  setVideoPreview: (videoPreview: VideoPreview | null) => void;
  /** True when a video is the subject, for the controls that differ. */
  isVideo: (state: AppState) => boolean;
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

type HistorySlice = Pick<AppState, "params" | "operations" | "effects" | "past" | "future">;

function historyOf(state: HistorySlice): HistoryState {
  return { past: state.past, future: state.future };
}

function currentOf(state: HistorySlice): HistoryEntry {
  return { params: state.params, operations: state.operations, effects: state.effects };
}

// Only the crop depends on the frame: it must fit whatever source is current,
// however it got here. A new source, a preset, an operation patch, or an undo
// landing a snapshot taken against a larger frame all go through here.
function fitToSource(source: ImageSource | null, operations: unknown): ImageOperations {
  return fitOperations(operations, source?.width ?? 0, source?.height ?? 0);
}

/** Shared state transition for an effect edit, history entry included. */
function effectChange(state: AppState, effects: StackedEffect[]): Partial<AppState> {
  return {
    effects,
    result: null,
    ...commitHistory(historyOf(state), currentOf(state), {
      params: state.params,
      operations: state.operations,
      effects,
    }),
  };
}

export const useApp = create<AppState>()((set, get) => ({
  media: null,
  source: null,
  params: {
    method: "Bayer 4x4",
    threshold: 128,
    palette: "Gruvbox",
    color: true,
    pixelSize: 4,
  },
  effects: [],
  operations: IDENTITY_OPERATIONS,
  result: null,
  preview: null,
  videoPreview: null,
  rendering: false,
  previewScaled: false,
  past: EMPTY_HISTORY.past,
  future: EMPTY_HISTORY.future,
  pendingVideo: null,
  mediaSeq: 0,
  beginMediaLoad: () => {
    const seq = get().mediaSeq + 1;
    set({ mediaSeq: seq });
    return seq;
  },
  clearSeq: 0,
  clearMedia: () =>
    set((state) => ({
      media: null,
      mediaSeq: state.mediaSeq + 1,
      source: null,
      // The canvas goes empty, whichever kind owned it. A clip stays loaded in
      // the timeline until it sees the counter below move, so the two agree
      // about what is on screen.
      videoPreview: null,
      result: null,
      preview: null,
      rendering: false,
      previewScaled: false,
      clearSeq: state.clearSeq + 1,
    })),
  loadVideo: (file, seq = get().mediaSeq) =>
    set({ pendingVideo: file === null ? null : { file, seq } }),
  setSource: (source) =>
    set((state) => ({
      source,
      // A crop belongs to the frame it was cut from, so the badge must follow.
      operations: fitToSource(source, state.operations),
      result: null,
      preview: null,
      // An image is the subject now, so whatever video frame was on the canvas
      // goes. The clip itself stays loaded in the timeline, but it no longer
      // owns the canvas and cannot take it back by a tab being reopened.
      videoPreview: null,
      media: source === null ? (state.media === "image" ? null : state.media) : "image",
      rendering: false,
      previewScaled: false,
    })),
  setParams: (params, operations, effects) =>
    set((state) => {
      // The variable-error diffusion family has no colour form, so colour and one
      // of those methods cannot be combined: the render would be rejected in the
      // worker. Presets, undo and import all land here, so this is the one place
      // that can keep the pair valid. The controls explain the change as it
      // happens; this is the backstop for the routes that do not go through them.
      const merged = { ...state.params, ...params };
      const nextParams =
        merged.color && !supportsColor(merged.method) ? { ...merged, color: false } : merged;
      // A second argument replaces the whole operation set, so applying a
      // preset without operations clears the previous ones.
      const nextOperations =
        operations === undefined ? state.operations : fitToSource(state.source, operations);
      // A preset passes its effect stack here too, so params, operations and
      // effects are one undo step instead of two.
      const nextEffects = effects === undefined ? state.effects : effects;
      return {
        params: nextParams,
        operations: nextOperations,
        effects: nextEffects,
        result: null,
        ...commitHistory(historyOf(state), currentOf(state), {
          params: nextParams,
          operations: nextOperations,
          effects: nextEffects,
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
          effects: state.effects,
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
        effects: state.effects,
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
        effects: step.entry.effects,
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
        effects: step.entry.effects,
        result: null,
      };
    }),
  setResult: (result) => set({ result, preview: null, rendering: false }),
  setPreview: (preview) => set({ preview }),
  setVideoPreview: (videoPreview) => set({ videoPreview }),
  showVideo: (videoPreview) =>
    set((state) => ({
      videoPreview,
      media: videoPreview === null ? (state.media === "video" ? null : state.media) : "video",
      // Loading a clip hands the canvas over, so the still is dropped exactly
      // as loading an image drops the clip.
      source: videoPreview === null ? state.source : null,
    })),
  setRendering: (rendering) => set({ rendering }),
  setPreviewScaled: (previewScaled) => set({ previewScaled }),
  isVideo: (state) => state.media === "video",
  setEffects: (effects) => set((state) => effectChange(state, effects)),
  addEffect: (type) =>
    set((state) =>
      effectChange(state, [
        ...state.effects,
        { key: uid(), type, params: defaultEffectParams(type), enabled: true },
      ]),
    ),
  removeEffect: (index) =>
    set((state) =>
      effectChange(
        state,
        state.effects.filter((_, i) => i !== index),
      ),
    ),
  moveEffect: (index, direction) =>
    set((state) => {
      const next = [...state.effects];
      const target = index + direction;
      if (target < 0 || target >= next.length) return state;
      [next[index], next[target]] = [next[target], next[index]];
      return effectChange(state, next);
    }),
  toggleEffect: (index) =>
    set((state) =>
      effectChange(
        state,
        state.effects.map((effect, i) =>
          i === index ? { ...effect, enabled: !effect.enabled } : effect,
        ),
      ),
    ),
  setEffectParam: (index, key, value) =>
    set((state) =>
      effectChange(
        state,
        state.effects.map((effect, i) =>
          i === index ? { ...effect, params: { ...effect.params, [key]: value } } : effect,
        ),
      ),
    ),
}));
