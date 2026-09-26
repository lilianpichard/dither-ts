import { describe, expect, it } from "vitest";
import { orderedAsyncPipeline } from "./pipeline";

function frame(value: number) {
  return { value };
}

describe("orderedAsyncPipeline", () => {
  it("bounds work and yields results in source order", async () => {
    let produced = 0;
    let consumed = 0;
    let active = 0;
    let maxActive = 0;
    const releasedInputs: number[] = [];
    const releasedOutputs: number[] = [];

    async function* source(): AsyncGenerator<{ value: number }> {
      for (let value = 0; value < 8; value++) {
        produced++;
        yield frame(value);
      }
    }

    async function transform(value: { value: number }): Promise<{ value: number }> {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value;
    }

    const values: number[] = [];
    for await (const value of orderedAsyncPipeline(source(), 2, transform, {
      releaseInput: (value) => releasedInputs.push(value.value),
      releaseOutput: (value) => releasedOutputs.push(value.value),
    })) {
      consumed++;
      values.push(value.value);
      expect(produced - consumed).toBeLessThanOrEqual(2);
    }

    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxActive).toBe(2);
    expect(releasedInputs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(releasedOutputs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("propagates transform errors and releases pending inputs", async () => {
    const released: number[] = [];
    async function* source(): AsyncGenerator<{ value: number }> {
      yield frame(0);
      yield frame(1);
      yield frame(2);
    }
    const pipeline = orderedAsyncPipeline(
      source(),
      2,
      async (value) => {
        if (value.value === 0) throw new Error("render failed");
        return value;
      },
      { releaseInput: (value) => released.push(value.value) },
    );

    await expect(pipeline.next()).rejects.toThrow("render failed");
    expect(released).toEqual([0, 1]);
  });

  it("does not wait for a hanging source return after a transform error", async () => {
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false, value: frame(0) }),
          return: () => new Promise<IteratorResult<{ value: number }>>(() => {}),
        };
      },
    };
    const pipeline = orderedAsyncPipeline(source, 1, async () => {
      throw new Error("render failed");
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          pipeline.next(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("pipeline cleanup timed out")), 50);
          }),
        ]),
      ).rejects.toThrow("render failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  });

  it("awaits source cleanup when the consumer stops normally", async () => {
    let resolveReturn!: (value: IteratorResult<{ value: number }>) => void;
    const returned = new Promise<IteratorResult<{ value: number }>>((resolve) => {
      resolveReturn = resolve;
    });
    let returnCalls = 0;
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false, value: frame(0) }),
          return: () => {
            returnCalls++;
            return returned;
          },
        };
      },
    };
    const pipeline = orderedAsyncPipeline(source, 1, async (value) => value);
    await expect(pipeline.next()).resolves.toMatchObject({ value: frame(0) });
    let settled = false;
    const stopping = pipeline.return?.().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(returnCalls).toBe(1);
    expect(settled).toBe(false);
    resolveReturn({ done: true, value: frame(0) });
    await stopping;
    expect(settled).toBe(true);
  });

  it("rejects a cancelled pipeline promptly", async () => {
    const controller = new AbortController();
    const pipeline = orderedAsyncPipeline(
      (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield frame(1);
      })(),
      1,
      async (value) => value,
      { signal: controller.signal },
    );
    const pending = pipeline.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("releases completed outputs when the consumer stops", async () => {
    const released: number[] = [];
    async function* source(): AsyncGenerator<{ value: number }> {
      yield frame(0);
      yield frame(1);
    }
    const iterator = orderedAsyncPipeline(source(), 2, async (value) => value, {
      releaseOutput: (value) => released.push(value.value),
    });
    await expect(iterator.next()).resolves.toMatchObject({ value: { value: 0 } });
    await iterator.return?.();
    expect(released).toEqual([0, 1]);
  });

  it("rejects invalid concurrency", async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1;
    }
    const pipeline = orderedAsyncPipeline(source(), 0, async (value) => value);
    await expect(pipeline.next()).rejects.toThrow(/concurrency/i);
  });
});
