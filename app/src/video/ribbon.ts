/** Where the playhead sits on the ribbon, as a fraction of the clip. */
export function playheadPercent(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(time)) return 0;
  return fraction(time, duration);
}

/** Where the selected range sits on the ribbon, as a fraction of the clip. */
export function spanPercent(
  range: { start: number; end: number },
  duration: number,
): { left: number; width: number } {
  if (!Number.isFinite(duration) || duration <= 0) return { left: 0, width: 0 };
  const start = Number.isFinite(range.start) ? fraction(range.start, duration) : 0;
  const end = Number.isFinite(range.end) ? fraction(range.end, duration) : 1;
  // A band is only ever drawn from the earlier edge to the later one: a range
  // that arrives inverted would otherwise render as nothing, which reads as no
  // selection at all rather than the whole clip.
  const left = Math.min(start, end);
  const right = Math.max(start, end);
  return { left, width: Math.max(0, right - left) };
}

/** Divide first and clamp after, so a position lands inside the ribbon. */
function fraction(value: number, duration: number): number {
  return Math.min(1, Math.max(0, value / duration));
}
