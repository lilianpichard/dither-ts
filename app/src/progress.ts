// Live-region text for long jobs: the text only changes at milestones, so a tick never re-announces. Outcomes already live in the toasts and the role="alert" panels, so this stays progress-only.

/** Percent between two announcements. */
export const ANNOUNCE_STEP = 25;

export interface ProgressState {
  /** Job name used in the milestone text, e.g. "Batch". */
  label: string;
  running: boolean;
  done: number;
  total: number;
}

/** Milestone text for a running job; "" while idle or before the first step. */
export function announceProgress({ label, running, done, total }: ProgressState): string {
  if (!running) return "";
  const raw = total > 0 ? (done / total) * 100 : 0;
  const percent = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
  const step = Math.floor(percent / ANNOUNCE_STEP) * ANNOUNCE_STEP;
  if (step <= 0) return `${label} started`;
  return `${label} ${step}%`;
}
