export interface OrderedPipelineOptions<T, R> {
  signal?: AbortSignal;
  releaseInput?: (value: T) => void;
  releaseOutput?: (value: R) => void;
}

type TaskResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

interface PendingTask<T, R> {
  input: T;
  inputReleased: boolean;
  hasOutput: boolean;
  outputRelease?: () => void;
  task: Promise<TaskResult<R>>;
}

function abortError(): Error {
  const error = new Error("frame pipeline cancelled");
  error.name = "AbortError";
  return error;
}

export function isPipelineAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function safeRelease(release: (() => void) | undefined): void {
  try {
    release?.();
  } catch {
    return;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

async function nextWithSignal<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  throwIfAborted(signal);
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      iterator.next().then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
    if (signal.aborted) onAbort();
  });
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export async function* orderedAsyncPipeline<T, R>(
  source: AsyncIterable<T>,
  concurrency: number,
  transform: (value: T, index: number, signal?: AbortSignal) => Promise<R>,
  options: OrderedPipelineOptions<T, R> = {},
): AsyncGenerator<R, void, unknown> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("pipeline concurrency must be a positive integer");
  }

  const iterator = source[Symbol.asyncIterator]();
  const pending = new Map<number, PendingTask<T, R>>();
  const signal = options.signal;
  let nextInput = 0;
  let nextOutput = 0;
  let sourceDone = false;
  let finished = false;
  let failed = false;

  const schedule = async (): Promise<void> => {
    while (!sourceDone && pending.size < concurrency) {
      throwIfAborted(signal);
      const result = await nextWithSignal(iterator, signal);
      if (result.done) {
        sourceDone = true;
        break;
      }
      const input = result.value;
      const index = nextInput++;
      const entry: PendingTask<T, R> = {
        input,
        inputReleased: false,
        hasOutput: false,
        task: Promise.resolve({ ok: true, value: undefined as R }),
      };
      let outputReleased = false;
      const releaseInput = (): void => {
        if (entry.inputReleased) return;
        entry.inputReleased = true;
        safeRelease(() => options.releaseInput?.(input));
      };
      const releaseOutput = (value: R): void => {
        if (outputReleased) return;
        outputReleased = true;
        safeRelease(() => options.releaseOutput?.(value));
      };
      entry.task = Promise.resolve()
        .then(() => {
          throwIfAborted(signal);
          return transform(input, index, signal);
        })
        .then(
          (value) => {
            releaseInput();
            entry.hasOutput = true;
            entry.outputRelease = () => releaseOutput(value);
            if (finished) releaseOutput(value);
            return { ok: true, value };
          },
          (error: unknown) => {
            releaseInput();
            return { ok: false, error };
          },
        );
      pending.set(index, entry);
    }
  };

  try {
    while (true) {
      await schedule();
      const entry = pending.get(nextOutput);
      if (!entry) {
        if (sourceDone) break;
        continue;
      }
      const result = await awaitWithSignal(entry.task, signal);
      pending.delete(nextOutput);
      nextOutput++;
      if (!result.ok) throw result.error;
      let released = false;
      const releaseOutput = (): void => {
        if (released) return;
        released = true;
        safeRelease(() => options.releaseOutput?.(result.value));
      };
      try {
        yield result.value;
      } finally {
        releaseOutput();
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    finished = true;
    for (const entry of pending.values()) {
      if (!entry.inputReleased) {
        entry.inputReleased = true;
        safeRelease(() => options.releaseInput?.(entry.input));
      }
      if (entry.hasOutput) {
        safeRelease(() => entry.outputRelease?.());
      }
    }
    if (!sourceDone) {
      try {
        const returned = iterator.return?.();
        if (signal?.aborted || failed) {
          void returned?.catch(() => {});
        } else {
          await returned;
        }
      } catch {}
    }
  }
}
