// Batch run bookkeeping: the status vocabulary, a running tally, an ETA, and
// the one line the run reports when it ends. Pure so the progress text and the
// toast can never disagree, and so a cancelled or failed run is never reported
// as a success.

export type BatchStatus = "queued" | "working" | "done" | "error" | "skipped";

export interface BatchItem {
  name: string;
  status: BatchStatus;
  detail?: string;
}

export interface BatchTally {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
}

export type BatchTone = "success" | "error" | "info";

export interface BatchOutcome {
  tone: BatchTone;
  message: string;
}

/** Statuses that will not change again in this run. */
const SETTLED: readonly BatchStatus[] = ["done", "error", "skipped"];

export function isSettled(status: BatchStatus): boolean {
  return SETTLED.includes(status);
}

/** Count settled items from a status list, ignoring anything in flight. */
export function settledCount(statuses: readonly BatchStatus[]): number {
  return statuses.filter(isSettled).length;
}

/**
 * Settle a run that was cancelled part way. Everything from `from` on will never
 * start, so it becomes skipped; entries already done or failed keep their
 * status, which is what keeps the written count honest. A file whose write
 * already resolved is `done` by then and is never counted as skipped.
 */
export function settleRemaining(entries: readonly BatchItem[], from: number): BatchItem[] {
  return entries.map((it, i) =>
    i >= from && !isSettled(it.status) ? { name: it.name, status: "skipped" as const } : it,
  );
}

/** Tally a status list; `cancelled` is passed in because it is not per-item. */
export function tally(statuses: readonly BatchStatus[], cancelled = false): BatchTally {
  return {
    total: statuses.length,
    done: statuses.filter((s) => s === "done").length,
    failed: statuses.filter((s) => s === "error").length,
    skipped: statuses.filter((s) => s === "skipped").length,
    cancelled,
  };
}

/** "1 image" / "3 images"; nouns past this point are phrased, not pluralised. */
function images(count: number): string {
  return `${count} ${count === 1 ? "image" : "images"}`;
}

/**
 * Milliseconds left, from recent per-file durations. Needs two samples and at
 * least one file still queued, so a first file never prints a bogus ETA.
 */
export function estimateEtaMs(samples: readonly number[], remaining: number): number | null {
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const usable = samples.filter((value) => Number.isFinite(value) && value >= 0);
  if (usable.length < 2) return null;
  const average = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  return Math.max(0, average * remaining);
}

/** Short, non-jittery ETA text; "" when there is not enough to go on. */
export function formatEta(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `about ${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  // "about 1m left" reads better than "about 1m 0s left".
  return rest === 0 ? `about ${minutes}m left` : `about ${minutes}m ${rest}s left`;
}

/**
 * One line for the end of a run. Anything other than a clean, uncancelled run
 * reports as `error` or `info`, never as a success.
 */
export function batchOutcome({
  total,
  done,
  failed,
  skipped,
  cancelled,
}: BatchTally): BatchOutcome {
  if (total === 0) return { tone: "info", message: "No images to process" };
  if (cancelled) {
    const parts = [`${images(done)} written`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    return { tone: "info", message: `Batch stopped: ${parts.join(", ")}` };
  }
  if (failed > 0) {
    const noun = failed === 1 ? "error" : "errors";
    return {
      tone: "error",
      message: `Batch finished with ${failed} ${noun}: ${done} of ${total} written`,
    };
  }
  return { tone: "success", message: `Batch finished: ${images(done)} written` };
}
