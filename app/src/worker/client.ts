import RenderWorker from "./render?worker";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";

const workers = new Map<string | undefined, Worker>();
let seq = 0;

export interface ProgressUpdate {
  rowsDone: number;
  totalRows: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
}

export interface RenderOptions {
  signal?: AbortSignal;
  timeout?: number;
  scope?: string;
}

interface PendingJob {
  resolve: (response: RenderResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (update: ProgressUpdate) => void;
  signal?: AbortSignal;
  timeoutId?: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
  scope?: string;
}

const pending = new Map<number, PendingJob>();

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function abortError(): Error {
  const error = new Error("render aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(timeout: number): Error {
  const error = new Error(`render timed out after ${timeout}ms`);
  error.name = "TimeoutError";
  return error;
}

function disposeWorker(target: Worker): void {
  target.onmessage = null;
  target.onerror = null;
  target.onmessageerror = null;
  try {
    target.terminate();
  } catch {
    return;
  }
}

function cleanupJob(id: number, job: PendingJob): void {
  if (job.timeoutId !== undefined) clearTimeout(job.timeoutId);
  job.removeAbort?.();
  if (pending.get(id) === job) pending.delete(id);
}

function resolveJob(id: number, response: RenderResponse): void {
  const job = pending.get(id);
  if (!job) return;
  cleanupJob(id, job);
  job.resolve(response);
}

function rejectJob(id: number, error: Error, rebuildIdle = false): void {
  const job = pending.get(id);
  if (!job) return;
  cleanupJob(id, job);
  job.reject(error);
  if (rebuildIdle) terminateWorker(job.scope);
}

function hasPending(scope: string | undefined): boolean {
  for (const job of pending.values()) {
    if (job.scope === scope) return true;
  }
  return false;
}

function terminateWorker(scope: string | undefined, expected?: Worker): void {
  if (hasPending(scope)) return;
  const current = workers.get(scope);
  if (!current || (expected !== undefined && current !== expected)) return;
  workers.delete(scope);
  disposeWorker(current);
}

function failScope(reason: Error, scope: string | undefined, expected?: Worker): void {
  for (const [id, job] of pending) {
    if (job.scope !== scope) continue;
    cleanupJob(id, job);
    job.reject(reason);
  }
  terminateWorker(scope, expected);
}

function failAll(reason: Error, scope?: string): void {
  if (scope !== undefined) {
    failScope(reason, scope);
    return;
  }
  for (const [id, job] of pending) {
    cleanupJob(id, job);
    job.reject(reason);
  }
  for (const key of workers.keys()) terminateWorker(key);
}

export function cancelAll(scope?: string): void {
  failAll(abortError(), scope);
}

function getWorker(scope?: string): Worker {
  const existing = workers.get(scope);
  if (existing) return existing;
  const created = new RenderWorker();
  workers.set(scope, created);
  created.onmessage = (event: MessageEvent<RenderMessage>) => {
    if (workers.get(scope) !== created) return;
    const message = event.data;
    const job = pending.get(message.id);
    if (!job || job.scope !== scope) return;
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
        rejectJob(message.id, asError(error), true);
      }
      return;
    }
    resolveJob(message.id, message);
  };
  created.onerror = (event) => {
    if (workers.get(scope) !== created) return;
    failScope(new Error(`render worker failed: ${event.message}`), scope, created);
  };
  created.onmessageerror = () => {
    if (workers.get(scope) !== created) return;
    failScope(new Error("render worker message failed to deserialize"), scope, created);
  };
  return created;
}

function validateTimeout(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError("timeout must be a finite non-negative number");
  }
  return timeout;
}

export function renderImage(
  req: Omit<RenderRequest, "id">,
  transfer: Transferable[],
  options?: RenderOptions,
): Promise<RenderResponse>;
export function renderImage(
  req: Omit<RenderRequest, "id">,
  transfer: Transferable[],
  onProgress: ((update: ProgressUpdate) => void) | undefined,
  options?: RenderOptions,
): Promise<RenderResponse>;
export function renderImage(
  req: Omit<RenderRequest, "id">,
  transfer: Transferable[],
  onProgressOrOptions?: ((update: ProgressUpdate) => void) | RenderOptions,
  maybeOptions?: RenderOptions,
): Promise<RenderResponse> {
  const onProgress = typeof onProgressOrOptions === "function" ? onProgressOrOptions : undefined;
  const options =
    typeof onProgressOrOptions === "object" && onProgressOrOptions !== null
      ? onProgressOrOptions
      : maybeOptions;
  const timeout = validateTimeout(options?.timeout);
  const signal = options?.signal;
  if (signal?.aborted) return Promise.reject(abortError());

  const id = ++seq;
  return new Promise((resolve, reject) => {
    const job: PendingJob = { resolve, reject, onProgress, signal, scope: options?.scope };
    const cancel = (error: Error): void => {
      if (options?.scope !== undefined) {
        failAll(error, options.scope);
      } else {
        rejectJob(id, error, true);
      }
    };
    pending.set(id, job);
    if (signal) {
      const onAbort = () => cancel(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
      job.removeAbort = () => signal.removeEventListener("abort", onAbort);
      if (signal.aborted) onAbort();
    }
    if (timeout !== undefined && pending.has(id)) {
      job.timeoutId = setTimeout(() => cancel(timeoutError(timeout)), timeout);
    }
    if (!pending.has(id)) return;
    try {
      getWorker(options?.scope).postMessage({ ...req, id }, { transfer });
    } catch (error) {
      rejectJob(id, asError(error), true);
    }
  });
}
