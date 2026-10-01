// Single source of truth for the render status line so the visible badge and
// the polite live region never drift apart. Pure string work, no DOM.

export interface RenderStatus {
  hasSource: boolean;
  rendering: boolean;
  /** Render time of the last complete result, null until one lands. */
  ms: number | null;
  previewScaled: boolean;
}

export const RENDERING_TEXT = "Rendering…";

/**
 * What to tell the user about something that failed outside a render: a
 * rejected promise, or an error event. An abort is not a failure, so it is
 * reported as nothing at all.
 */
export function describeUncaught(reason: unknown): string {
  if (isAbort(reason)) return "";
  let message = "";
  if (reason instanceof Error) message = reason.message;
  else if (typeof reason === "string") message = reason;
  return message ? `Unexpected error: ${message}` : "Unexpected error";
}

/** True for the cancellation this app raises, which is never worth reporting. */
export function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

/** One wording for the visible badge and the polite live region. */
export function describeRenderStatus({
  hasSource,
  rendering,
  ms,
  previewScaled,
}: RenderStatus): string {
  if (!hasSource) return "No image";
  if (rendering) return RENDERING_TEXT;
  if (ms === null || !Number.isFinite(ms)) return "Ready";
  const scaled = previewScaled ? " · scaled" : "";
  return `Done in ${ms.toFixed(1)} ms${scaled}`;
}
