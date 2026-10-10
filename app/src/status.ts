// Single source of truth for the render status line so the visible badge and
// the polite live region never drift apart. Pure string work, no DOM, and every
// string comes from the catalogue rather than being written here.

import type { Translate } from "./i18n";

export interface RenderStatus {
  hasSource: boolean;
  rendering: boolean;
  /** Render time of the last complete result, null until one lands. */
  ms: number | null;
  previewScaled: boolean;
}

/** One wording for the visible badge and the polite live region. */
export function describeRenderStatus(
  { hasSource, rendering, ms, previewScaled }: RenderStatus,
  t: Translate,
): string {
  if (!hasSource) return t("status.noImage");
  if (rendering) return t("status.rendering");
  if (ms === null || !Number.isFinite(ms)) return t("status.ready");
  // The decimal count and the digit grouping are the message's job, so the raw
  // number is passed through and ICU formats it for the language.
  return previewScaled ? t("status.doneScaled", { ms }) : t("status.done", { ms });
}

/** "{width}×{height} · {method} · {threshold} · {pixelSize}px" under the canvas. */
export function describeCanvasCaption(
  fields: { width: number; height: number; method: string; threshold: number; pixelSize: number },
  t: Translate,
): string {
  return t("status.caption", fields);
}

/**
 * What to tell the user about something that failed outside a render: a
 * rejected promise, or an error event. An abort is not a failure, so it is
 * reported as nothing at all.
 */
export function describeUncaught(reason: unknown, t: Translate): string {
  if (isAbort(reason)) return "";
  let message = "";
  if (reason instanceof Error) message = reason.message;
  else if (typeof reason === "string") message = reason;
  return t("error.boundary", { reason: message || "an unknown error" });
}

/** True for the cancellation this app raises, which is never worth reporting. */
export function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}
