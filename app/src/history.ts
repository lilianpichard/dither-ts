// Bounded undo/redo over param + operation state, never pixels: re-rendering
// is cheap, so history stores cheap snapshots and lets the normal preview
// path run again. Slider and crop drags coalesce into one entry; discrete
// toggles each get their own.

import type { DitherParams } from "./store";
import { sanitizeOperations } from "./image/settings";
import type { ImageOperations } from "./image/ops";
import type { RGB } from "../../src/index.js";

/** Matches the documented cap: 20 undo steps. */
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  params: DitherParams;
  operations: ImageOperations;
}

export interface HistoryState {
  /** States before the current one, oldest first. */
  past: HistoryEntry[];
  /** States after the current one, nearest first. */
  future: HistoryEntry[];
}

export interface HistoryStep {
  history: HistoryState;
  /** State to apply, or null when the step was a no-op. */
  entry: HistoryEntry | null;
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

// Continuous controls: repeated steps of one control extend a single entry.
const COALESCING = new Set([
  "params.threshold",
  "params.pixelSize",
  "operations.brightness",
  "operations.contrast",
  "operations.saturation",
  "operations.hue",
  "operations.crop",
]);

const PARAM_KEYS = [
  "method",
  "threshold",
  "palette",
  "color",
  "pixelSize",
] as const satisfies readonly (keyof DitherParams)[];

const OPERATION_KEYS = [
  "crop",
  "rotate",
  "flipHorizontal",
  "flipVertical",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "invert",
] as const satisfies readonly (keyof ImageOperations)[];

function clone(entry: HistoryEntry): HistoryEntry {
  return {
    // Custom palettes are mutable arrays: copy them so a later edit cannot
    // rewrite a snapshot that history still holds.
    params: { ...entry.params, palette: clonePalette(entry.params.palette) },
    operations: sanitizeOperations(entry.operations),
  };
}

function clonePalette(palette: DitherParams["palette"]): DitherParams["palette"] {
  if (!Array.isArray(palette)) return palette;
  return palette.map((color) => [...color] as RGB);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Paths of the fields that differ between two snapshots, in field order. */
function changedKeys(previous: HistoryEntry, next: HistoryEntry): string[] {
  const keys: string[] = [];
  for (const key of PARAM_KEYS) {
    if (!sameValue(previous.params[key], next.params[key])) keys.push(`params.${key}`);
  }
  for (const key of OPERATION_KEYS) {
    if (!sameValue(previous.operations[key], next.operations[key])) {
      keys.push(`operations.${key}`);
    }
  }
  return keys;
}

function repeatable(keys: string[]): boolean {
  return keys.length > 0 && keys.every((key) => COALESCING.has(key));
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/**
 * Record the state being replaced. A no-op change leaves history alone and a
 * fresh edit drops the redo branch; a repeat edit of the same continuous
 * control keeps the entry that already covers it, so one drag is one undo.
 */
export function commitHistory(
  history: HistoryState,
  previous: HistoryEntry,
  next: HistoryEntry,
): HistoryState {
  const keys = changedKeys(previous, next);
  if (keys.length === 0) return history;
  const top = history.past.at(-1);
  if (top && repeatable(keys) && sameKeys(changedKeys(top, previous), keys)) {
    return { past: history.past, future: [] };
  }
  return { past: [...history.past, clone(previous)].slice(-HISTORY_LIMIT), future: [] };
}

export function undoHistory(history: HistoryState, current: HistoryEntry): HistoryStep {
  const entry = history.past.at(-1);
  if (!entry) return { history, entry: null };
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [clone(current), ...history.future].slice(0, HISTORY_LIMIT),
    },
    entry: clone(entry),
  };
}

export function redoHistory(history: HistoryState, current: HistoryEntry): HistoryStep {
  const [entry, ...rest] = history.future;
  if (!entry) return { history, entry: null };
  return {
    history: {
      past: [...history.past, clone(current)].slice(-HISTORY_LIMIT),
      future: rest,
    },
    entry: clone(entry),
  };
}
