import RenderWorker from "./render?worker";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";
import type { ProgressUpdate } from "./client";

export interface WorkerLike {
  postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  terminate(): void;
  onmessage: ((this: any, e: MessageEvent) => void) | null;
  onerror: ((this: any, e: ErrorEvent) => void) | null;
  onmessageerror: ((this: any, e: MessageEvent) => void) | null;
}

interface PoolJob {
  resolve: (r: RenderResponse) => void;
  reject: (e: Error) => void;
  onProgress?: (u: ProgressUpdate) => void;
  slot: PoolSlot;
}

interface PoolSlot {
  worker: WorkerLike;
  busy: boolean;
  jobId: number | null;
}

/** Default pool size: all cores but one, clamped to 1..8. */
export function defaultPoolSize(): number {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(8, Math.max(1, cores - 1));
}

/**
 * Fixed-size pool of render workers. Jobs run on idle workers in FIFO
 * order; responses route by id so completion order never matters.
 * invalidate() rejects everything in flight and rebuilds dead workers.
 */
export class RenderPool {
  private slots: PoolSlot[] = [];
  private queue: Array<(slot: PoolSlot) => void> = [];
  private seq = 0;
  private generation = 0;
  private readonly spawn: () => WorkerLike;

  constructor(size = defaultPoolSize(), spawn: () => WorkerLike = () => new RenderWorker()) {
    this.spawn = spawn;
    for (let i = 0; i < Math.max(1, size); i++) this.slots.push(this.makeSlot());
  }

  get size(): number {
    return this.slots.length;
  }

  get queued(): number {
    return this.queue.length;
  }

  private makeSlot(): PoolSlot {
    const slot: PoolSlot = { worker: this.spawn(), busy: false, jobId: null };
    this.attach(slot);
    const fail = (reason: Error) => {
      for (const [id, job] of this.jobs) {
        if (job.slot === slot) {
          this.jobs.delete(id);
          job.reject(reason);
        }
      }
      try {
        slot.worker.terminate();
      } catch {
        // Already gone; replaced below regardless.
      }
      slot.worker = this.spawn();
      this.attach(slot);
      slot.busy = false;
      slot.jobId = null;
      this.pump();
    };
    slot.worker.onerror = () => fail(new Error("pool worker failed"));
    slot.worker.onmessageerror = () => fail(new Error("pool worker message failed"));
    return slot;
  }

  private attach(slot: PoolSlot): void {
    slot.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as RenderMessage;
      const job = this.jobs.get(msg.id);
      if (!job || job.slot !== slot) return;
      if (msg.kind === "progress") {
        job.onProgress?.({
          rowsDone: msg.rowsDone,
          totalRows: msg.totalRows,
          width: msg.width,
          height: msg.height,
          pixels: msg.pixels,
        });
        return;
      }
      this.jobs.delete(msg.id);
      slot.busy = false;
      slot.jobId = null;
      job.resolve(msg);
      this.pump();
    };
  }

  private jobs = new Map<number, PoolJob>();

  private pump(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((s) => !s.busy);
      if (!slot) return;
      const task = this.queue.shift()!;
      task(slot);
    }
  }

  render(
    req: Omit<RenderRequest, "id">,
    transfer: Transferable[],
    onProgress?: (u: ProgressUpdate) => void,
  ): Promise<RenderResponse> {
    const gen = this.generation;
    return new Promise((resolve, reject) => {
      this.queue.push((slot: PoolSlot) => {
        if (gen !== this.generation) {
          reject(new Error("cancelled"));
          this.pump();
          return;
        }
        const id = ++this.seq;
        slot.busy = true;
        slot.jobId = id;
        this.jobs.set(id, { resolve, reject, onProgress, slot });
        try {
          slot.worker.postMessage({ ...req, id }, { transfer });
        } catch (err) {
          this.jobs.delete(id);
          slot.busy = false;
          slot.jobId = null;
          reject(err instanceof Error ? err : new Error(String(err)));
          this.pump();
        }
      });
      this.pump();
    });
  }

  /** Reject all pending work and rebuild every worker. */
  invalidate(): void {
    this.generation++;
    this.queue.length = 0;
    for (const [, job] of this.jobs) job.reject(new Error("cancelled"));
    this.jobs.clear();
    for (const slot of this.slots) {
      try {
        slot.worker.terminate();
      } catch {
        // Ignore teardown failures; the slot is rebuilt regardless.
      }
      slot.worker = this.spawn();
      this.attach(slot);
      slot.busy = false;
      slot.jobId = null;
    }
  }
}

let shared: RenderPool | null = null;

/** Lazily built shared pool (no workers until first render). */
export function getPool(): RenderPool {
  if (!shared) shared = new RenderPool();
  return shared;
}
