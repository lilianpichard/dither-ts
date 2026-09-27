import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderPool, defaultPoolSize, type WorkerLike } from "./pool";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";

class FakeWorker {
  onmessage: ((e: MessageEvent<RenderMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(msg: RenderMessage): void {
    this.onmessage?.({ data: msg } as MessageEvent<RenderMessage>);
  }
}

function req(n: number): Omit<RenderRequest, "id"> {
  return {
    width: 2,
    height: 2,
    pixels: new ArrayBuffer(16),
    color: false,
    colorMode: "palette",
    method: "None",
    threshold: 128,
    palette: "B&W",
    pixelSize: 1,
    effects: [],
    seed: n,
  };
}

function result(id: number): RenderResponse {
  return { kind: "result", id, width: 2, height: 2, pixels: new ArrayBuffer(16), ms: 1 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("render pool", () => {
  it("sizes within 1..8", () => {
    expect(defaultPoolSize()).toBeGreaterThanOrEqual(1);
    expect(defaultPoolSize()).toBeLessThanOrEqual(8);
    expect(new RenderPool(3, () => new FakeWorker() as unknown as WorkerLike).size).toBe(3);
  });

  it("dispatches to idle workers and queues the rest", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(2, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as WorkerLike;
    });
    const p1 = pool.render(req(1), []);
    const p2 = pool.render(req(2), []);
    const p3 = pool.render(req(3), []);
    expect(workers[0].sent.length).toBe(1);
    expect(workers[1].sent.length).toBe(1);
    expect(pool.queued).toBe(1);
    workers[0].respond(result(1));
    await expect(p1).resolves.toMatchObject({ kind: "result" });
    expect(workers[0].sent.length).toBe(2);
    workers[1].respond(result(2));
    workers[0].respond(result(3));
    await expect(p2).resolves.toMatchObject({ kind: "result" });
    await expect(p3).resolves.toMatchObject({ kind: "result" });
  });

  it("routes out-of-order completions to the right jobs", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(2, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as WorkerLike;
    });
    const seen: number[] = [];
    const p1 = pool.render(req(1), []).then((r) => {
      if (r.kind === "result") seen.push(r.ms);
      return r;
    });
    const p2 = pool.render(req(2), []).then((r) => {
      if (r.kind === "result") seen.push(r.ms);
      return r;
    });
    workers[1].respond({ ...result(2), ms: 20 });
    workers[0].respond({ ...result(1), ms: 10 });
    await p1;
    await p2;
    expect(seen).toEqual([20, 10]);
  });

  it("forwards progress without resolving", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(1, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as WorkerLike;
    });
    const progress: number[] = [];
    let resolved = false;
    const p = pool
      .render(req(1), [], (u) => progress.push(u.rowsDone))
      .then((r) => {
        resolved = true;
        return r;
      });
    workers[0].respond({
      kind: "progress",
      id: 1,
      width: 2,
      height: 2,
      rowsDone: 1,
      totalRows: 2,
      pixels: new ArrayBuffer(16),
    });
    expect(progress).toEqual([1]);
    expect(resolved).toBe(false);
    workers[0].respond(result(1));
    await p;
    expect(resolved).toBe(true);
  });

  it("rebuilds a failed worker and rejects its job", async () => {
    const workers: FakeWorker[] = [];
    const spawn = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as WorkerLike;
    });
    const pool = new RenderPool(1, spawn);
    const p1 = pool.render(req(1), []);
    const p2 = pool.render(req(2), []);
    workers[0].onerror?.({} as ErrorEvent);
    await expect(p1).rejects.toThrow("pool worker failed");
    expect(workers[0].terminated).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    // Pool keeps serving on the replacement worker.
    workers[1].respond(result(2));
    await expect(p2).resolves.toMatchObject({ kind: "result" });
  });

  it("invalidate rejects everything pending", async () => {
    const pool = new RenderPool(1, () => new FakeWorker() as unknown as WorkerLike);
    const p = pool.render(req(1), []);
    pool.invalidate();
    await expect(p).rejects.toThrow("cancelled");
  });

  it("rejects queued jobs when invalidated", async () => {
    const pool = new RenderPool(1, () => new FakeWorker() as unknown as WorkerLike);
    const active = pool.render(req(1), []);
    const queued = pool.render(req(2), []);
    pool.invalidate();
    await expect(active).rejects.toThrow("cancelled");
    const outcome = await Promise.race([
      queued.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 25)),
    ]);
    expect(outcome).toBe("rejected");
  });

  it("attaches error handlers to replacement workers", async () => {
    const workers: FakeWorker[] = [];
    const spawn = vi.fn(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as WorkerLike;
    });
    const pool = new RenderPool(1, spawn);
    const active = pool.render(req(1), []);
    pool.invalidate();
    await expect(active).rejects.toThrow("cancelled");
    expect(workers[1].onerror).toBeTypeOf("function");
    expect(workers[1].onmessageerror).toBeTypeOf("function");
    const replacement = pool.render(req(2), []);
    workers[1].onerror?.({} as ErrorEvent);
    await expect(replacement).rejects.toThrow("pool worker failed");
    expect(workers[1].terminated).toBe(true);
    expect(workers.length).toBe(3);
    const next = pool.render(req(3), []);
    workers[2].respond(result(3));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });

  it("aborts queued and active jobs and rebuilds the active slot", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(1, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    });
    const activeController = new AbortController();
    const queuedController = new AbortController();
    const active = pool.render(req(1), [], undefined, { signal: activeController.signal });
    const queued = pool.render(req(2), [], { signal: queuedController.signal });
    queuedController.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(pool.queued).toBe(0);
    activeController.abort();
    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0].terminated).toBe(true);
    const next = pool.render(req(3), []);
    workers[1].respond(result(2));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });

  it("times out queued jobs from the call time", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(1, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    });
    const active = pool.render(req(1), []);
    const queued = pool.render(req(2), [], { timeout: 25 });
    const rejection = expect(queued).rejects.toThrow(/timed out.*25ms/);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(pool.queued).toBe(0);
    workers[0].respond(result(1));
    await expect(active).resolves.toMatchObject({ kind: "result" });
  });

  it("times out active jobs and rebuilds their slots", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const pool = new RenderPool(1, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as WorkerLike;
    });
    const active = pool.render(req(1), [], { timeout: 10 });
    const rejection = expect(active).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(workers[0].terminated).toBe(true);
    const next = pool.render(req(2), []);
    workers[1].respond(result(2));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });
});
