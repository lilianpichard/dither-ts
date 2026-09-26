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

export interface RenderPoolOptions {
  signal?: AbortSignal;
  timeout?: number;
}

interface PoolJob {
  resolve: (response: RenderResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (update: ProgressUpdate) => void;
  removeAbort?: () => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  generation: number;
  id: number | null;
  slot: PoolSlot | null;
  settled: boolean;
  request: Omit<RenderRequest, "id">;
  transfer: Transferable[];
}

interface PoolSlot {
  worker: WorkerLike;
  busy: boolean;
  jobId: number | null;
}

export function defaultPoolSize(): number {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(8, Math.max(1, cores - 1));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function abortError(): Error {
  const error = new Error("pool render aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(timeout: number): Error {
  const error = new Error(`pool render timed out after ${timeout}ms`);
  error.name = "TimeoutError";
  return error;
}

function validateTimeout(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError("timeout must be a finite non-negative number");
  }
  return timeout;
}

export class RenderPool {
  private slots: PoolSlot[] = [];
  private queue: PoolJob[] = [];
  private seq = 0;
  private generation = 0;
  private readonly spawn: () => WorkerLike;
  private jobs = new Map<number, PoolJob>();

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
    return slot;
  }

  private attach(slot: PoolSlot): void {
    const current = slot.worker;
    current.onmessage = (event: MessageEvent) => {
      if (slot.worker !== current) return;
      const message = event.data as RenderMessage;
      const job = this.jobs.get(message.id);
      if (!job || job.slot !== slot) return;
      if (message.kind === "progress") {
        try {
          job.onProgress?.({
            rowsDone: message.rowsDone,
            totalRows: message.totalRows,
            width: message.width,
            height: message.height,
            pixels: message.pixels,
          });
        } catch (error) {
          this.replaceSlot(slot, current, asError(error));
        }
        return;
      }
      this.resolveJob(job, message);
    };
    current.onerror = () => this.replaceSlot(slot, current, new Error("pool worker failed"));
    current.onmessageerror = () =>
      this.replaceSlot(slot, current, new Error("pool worker message failed"));
  }

  private removeQueued(job: PoolJob): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private cleanup(job: PoolJob): void {
    if (job.timeoutId !== undefined) clearTimeout(job.timeoutId);
    job.removeAbort?.();
  }

  private releaseSlot(job: PoolJob): PoolSlot | undefined {
    const slot = job.slot;
    if (!slot) return undefined;
    if (job.id !== null && this.jobs.get(job.id) === job) this.jobs.delete(job.id);
    if (slot.busy && slot.jobId === job.id) {
      slot.busy = false;
      slot.jobId = null;
    }
    job.slot = null;
    job.id = null;
    return slot;
  }

  private resolveJob(job: PoolJob, response: RenderResponse): void {
    if (job.settled) return;
    job.settled = true;
    this.cleanup(job);
    this.releaseSlot(job);
    job.resolve(response);
    this.pump();
  }

  private rejectJob(job: PoolJob, error: Error, rebuild = false): PoolSlot | undefined {
    if (job.settled) return undefined;
    job.settled = true;
    this.cleanup(job);
    const slot = this.releaseSlot(job);
    job.reject(error);
    if (rebuild && slot) this.rebuildSlot(slot);
    return slot;
  }

  private replaceSlot(slot: PoolSlot, failed: WorkerLike, reason: Error): void {
    if (slot.worker !== failed) return;
    const job = [...this.jobs.values()].find((candidate) => candidate.slot === slot);
    if (job) this.rejectJob(job, reason);
    this.rebuildSlot(slot);
    this.pump();
  }

  private rebuildSlot(slot: PoolSlot): void {
    const old = slot.worker;
    old.onmessage = null;
    old.onerror = null;
    old.onmessageerror = null;
    try {
      old.terminate();
    } catch {}
    slot.worker = this.spawn();
    this.attach(slot);
    slot.busy = false;
    slot.jobId = null;
  }

  private cancel(job: PoolJob, error: Error, rebuild = false): void {
    if (job.settled) return;
    if (!job.slot) this.removeQueued(job);
    this.rejectJob(job, error, rebuild);
    this.pump();
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const job = this.queue[0]!;
      if (job.settled) {
        this.queue.shift();
        continue;
      }
      const slot = this.slots.find((candidate) => !candidate.busy);
      if (!slot) return;
      this.queue.shift();
      if (job.generation !== this.generation) {
        this.rejectJob(job, new Error("cancelled"));
        continue;
      }
      const id = ++this.seq;
      job.id = id;
      job.slot = slot;
      slot.busy = true;
      slot.jobId = id;
      this.jobs.set(id, job);
      try {
        slot.worker.postMessage({ ...job.request, id }, { transfer: job.transfer });
      } catch (error) {
        this.rejectJob(job, asError(error));
      }
    }
  }

  private start(
    req: Omit<RenderRequest, "id">,
    transfer: Transferable[],
    onProgress: ((update: ProgressUpdate) => void) | undefined,
    options: RenderPoolOptions | undefined,
  ): Promise<RenderResponse> {
    const timeout = validateTimeout(options?.timeout);
    const signal = options?.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const job: PoolJob = {
        resolve,
        reject,
        onProgress,
        generation: this.generation,
        id: null,
        slot: null,
        settled: false,
        request: req,
        transfer,
      };
      this.queue.push(job);
      if (signal) {
        const onAbort = (): void => this.cancel(job, abortError(), true);
        signal.addEventListener("abort", onAbort, { once: true });
        job.removeAbort = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
      }
      if (timeout !== undefined && !job.settled) {
        job.timeoutId = setTimeout(() => this.cancel(job, timeoutError(timeout), true), timeout);
      }
      this.pump();
    });
  }

  render(
    req: Omit<RenderRequest, "id">,
    transfer: Transferable[],
    onProgress?: (update: ProgressUpdate) => void,
    options?: RenderPoolOptions,
  ): Promise<RenderResponse>;
  render(
    req: Omit<RenderRequest, "id">,
    transfer: Transferable[],
    options?: RenderPoolOptions,
  ): Promise<RenderResponse>;
  render(
    req: Omit<RenderRequest, "id">,
    transfer: Transferable[],
    onProgressOrOptions?: ((update: ProgressUpdate) => void) | RenderPoolOptions,
    maybeOptions?: RenderPoolOptions,
  ): Promise<RenderResponse> {
    const onProgress = typeof onProgressOrOptions === "function" ? onProgressOrOptions : undefined;
    const options =
      typeof onProgressOrOptions === "object" && onProgressOrOptions !== null
        ? onProgressOrOptions
        : maybeOptions;
    return this.start(req, transfer, onProgress, options);
  }

  invalidate(): void {
    this.generation++;
    const queued = this.queue.splice(0);
    for (const job of queued) this.rejectJob(job, new Error("cancelled"));
    const active = [...this.jobs.values()];
    for (const job of active) this.rejectJob(job, new Error("cancelled"));
    for (const slot of this.slots) this.rebuildSlot(slot);
    this.pump();
  }
}

let shared: RenderPool | null = null;

export function getPool(): RenderPool {
  if (!shared) shared = new RenderPool();
  return shared;
}
