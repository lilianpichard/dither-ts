// Transport state for the video panel: where play, step and loop land, and
// when the dithered preview is due for a refresh. Pure arithmetic over clip
// metadata so the UI never holds a transition rule of its own.

import type { Translate } from "../i18n";

/** Cadence floor for dithered preview refreshes while playing. */
export const PREVIEW_INTERVAL_MS = 120;

/** Playhead movement below this is not worth spending a render on. */
export const PREVIEW_MOVE_EPSILON = 0.004;

/** Below this a seek is a no-op anyway, so a step lands where it started. */
const MIN_STEP_SECONDS = 1e-4;
/** Treated as "at the end" once the playhead is this close. */
const END_EPSILON = 1e-3;

function safeDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function clampTime(time: number, duration: number): number {
  const limit = safeDuration(duration);
  if (!Number.isFinite(time)) return 0;
  return Math.min(limit, Math.max(0, time));
}

/** One frame forward or back, clamped into the clip. */
export function stepTime(time: number, direction: 1 | -1, step: number, duration: number): number {
  const size = Math.abs(step);
  if (!Number.isFinite(size) || size < MIN_STEP_SECONDS) return clampTime(time, duration);
  return clampTime(clampTime(time, duration) + direction * size, duration);
}

/** Jump to the first or last frame of the clip. */
export function jumpTime(direction: 1 | -1, duration: number): number {
  return direction === -1 ? 0 : safeDuration(duration);
}

function isAtEnd(time: number, duration: number): boolean {
  return (
    safeDuration(duration) > 0 && clampTime(time, duration) >= safeDuration(duration) - END_EPSILON
  );
}

export interface PlaybackStep {
  /** Time the UI should show, which is the end once playback finishes. */
  time: number;
  /** The element has to be seeked back to the head to carry on looping. */
  wrapped: boolean;
  /** Playback ran off the end and should stop. */
  finished: boolean;
}

/**
 * One playback tick's decision. A playhead that reaches the end reports the
 * end as its display time, so stopping never leaves the readout a frame short.
 */
export function advancePlayback(
  currentTime: number,
  duration: number,
  loop: boolean,
): PlaybackStep {
  const at = clampTime(currentTime, duration);
  if (!isAtEnd(at, duration)) return { time: at, wrapped: false, finished: false };
  if (loop) return { time: 0, wrapped: true, finished: false };
  return { time: safeDuration(duration), wrapped: false, finished: true };
}

/** One line for the visible badge and the polite live region. */
export function transportStatus(
  {
    playing,
    time,
    duration,
    loop,
  }: {
    playing: boolean;
    time: number;
    duration: number;
    loop: boolean;
  },
  t: Translate,
): string {
  const at = clampTime(time, duration);
  const total = safeDuration(duration);
  const values = { at, total };
  const suffix = loop ? t("timeline.looping") : "";
  if (playing) return t("timeline.playing", values) + suffix;
  if (!Number.isFinite(time) || total === 0) return t("timeline.empty");
  if (isAtEnd(time, duration)) return t("timeline.stoppedEnd", values);
  return t("timeline.paused", values) + suffix;
}

/**
 * Throttle gate for the dithered canvas while playing. Real-time dithering
 * cannot keep up, so refreshes are spread out and the newest frame wins.
 */
export function previewDue({
  playing,
  lastAt,
  now,
  intervalMs = PREVIEW_INTERVAL_MS,
}: {
  playing: boolean;
  /** Timestamp of the last accepted refresh, or null when none has landed. */
  lastAt: number | null;
  now: number;
  intervalMs?: number;
}): boolean {
  if (!playing) return true;
  if (lastAt === null || !Number.isFinite(lastAt)) return true;
  if (!Number.isFinite(now)) return false;
  return now - lastAt >= intervalMs;
}

/**
 * Whether a coalesced preview still has something new to show. A render is
 * never cancelled to chase the playhead: it finishes, and only then is the
 * newest target picked up, which is what keeps a slow method from starving.
 */
export function targetMoved(
  shown: number | null,
  target: number | null,
  epsilon = PREVIEW_MOVE_EPSILON,
): boolean {
  if (target === null || !Number.isFinite(target)) return false;
  if (shown === null || !Number.isFinite(shown)) return true;
  return Math.abs(target - shown) > epsilon;
}

export interface LivePreviewGate {
  playing: boolean;
  /** A render is already running; it is left to finish, never cancelled. */
  inFlight: boolean;
  /** Timestamp of the last dispatch, or null when none has happened. */
  lastAt: number | null;
  now: number;
  /** Time last put on the canvas, or null when nothing has landed. */
  shown: number | null;
  /** Newest playhead position recorded by the tick. */
  target: number | null;
  intervalMs?: number;
}

/**
 * The one decision behind starting a playback render, shared by the tick and
 * by the follow-up after a render lands. Never true while one is in flight,
 * which is what makes the preview coalesce instead of cancelling itself.
 */
export function shouldRenderLive({
  playing,
  inFlight,
  lastAt,
  now,
  shown,
  target,
  intervalMs = PREVIEW_INTERVAL_MS,
}: LivePreviewGate): boolean {
  if (!playing || inFlight) return false;
  if (!previewDue({ playing, lastAt, now, intervalMs })) return false;
  return targetMoved(shown, target);
}
