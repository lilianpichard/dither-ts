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
