import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderMessage, RenderRequest, RenderResponse } from "./render";

const workerState = vi.hoisted(() => ({
  workers: [] as Array<{
    onmessage: ((event: MessageEvent<RenderMessage>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    sent: unknown[];
    terminated: boolean;
    respond: (message: RenderMessage) => void;
  }>,
}));

vi.mock("./render?worker", () => ({
  default: class MockWorker {
    onmessage: ((event: MessageEvent<RenderMessage>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    sent: unknown[] = [];
    terminated = false;

    constructor() {
      workerState.workers.push(this);
    }

    postMessage(message: unknown): void {
      this.sent.push(message);
    }

    terminate(): void {
      this.terminated = true;
    }

    respond(message: RenderMessage): void {
      this.onmessage?.({ data: message } as MessageEvent<RenderMessage>);
    }
  },
}));

function request(): Omit<RenderRequest, "id"> {
  return {
    width: 1,
    height: 1,
    pixels: new ArrayBuffer(4),
    color: false,
    method: "None",
    threshold: 128,
    palette: "B&W",
    pixelSize: 1,
    effects: [],
    seed: 0,
  };
}

function result(id: number): RenderResponse {
  return { kind: "result", id, width: 1, height: 1, pixels: new ArrayBuffer(4), ms: 1 };
}

async function client() {
  return import("./client");
}

beforeEach(async () => {
  vi.resetModules();
  workerState.workers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("render client lifecycle", () => {
  it("settles aborted jobs and ignores their later messages", async () => {
    const { renderImage } = await client();
    const controller = new AbortController();
    const progress: number[] = [];
    const pending = renderImage(request(), [], (update) => progress.push(update.rowsDone), {
      signal: controller.signal,
    });
    const worker = workerState.workers[0];
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    worker.respond({
      kind: "progress",
      id: 1,
      width: 1,
      height: 1,
      rowsDone: 1,
      totalRows: 1,
      pixels: new ArrayBuffer(4),
    });
    worker.respond(result(1));
    expect(progress).toEqual([]);
    expect(worker.terminated).toBe(true);
  });

  it("settles timed-out jobs and rebuilds an idle worker", async () => {
    vi.useFakeTimers();
    const { renderImage } = await client();
    const pending = renderImage(request(), [], undefined, { timeout: 10 });
    const rejection = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(workerState.workers[0].terminated).toBe(true);
    const next = renderImage(request(), []);
    expect(workerState.workers).toHaveLength(2);
    workerState.workers[1].respond(result(2));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });

  it("cancels all pending work and rebuilds the shared worker", async () => {
    const { cancelAll, renderImage } = await client();
    const first = renderImage(request(), []);
    const second = renderImage(request(), []);
    cancelAll();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workerState.workers[0].terminated).toBe(true);
    const next = renderImage(request(), []);
    expect(workerState.workers).toHaveLength(2);
    workerState.workers[1].respond(result(3));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });

  it("can cancel a preview scope without canceling batch or preset work", async () => {
    const { cancelAll, renderImage } = await client();
    const preview = renderImage(request(), [], { scope: "preview" });
    const batch = renderImage(request(), []);
    expect(workerState.workers).toHaveLength(2);
    cancelAll("preview");
    await expect(preview).rejects.toMatchObject({ name: "AbortError" });
    workerState.workers[1].respond(result(2));
    await expect(batch).resolves.toMatchObject({ kind: "result" });
    expect(workerState.workers[0].terminated).toBe(true);
    expect(workerState.workers[1].terminated).toBe(false);
  });

  it("terminates a canceled preview worker while an unrelated render is still running", async () => {
    const { cancelAll, renderImage } = await client();
    const first = renderImage(request(), [], { scope: "preview" });
    const second = renderImage(request(), [], { scope: "preview" });
    const still = renderImage(request(), []);
    expect(workerState.workers).toHaveLength(2);
    cancelAll("preview");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workerState.workers[0].terminated).toBe(true);
    workerState.workers[1].respond(result(3));
    await expect(still).resolves.toMatchObject({ kind: "result" });
    const next = renderImage(request(), [], { scope: "preview" });
    expect(workerState.workers).toHaveLength(3);
    workerState.workers[2].respond(result(4));
    await expect(next).resolves.toMatchObject({ kind: "result" });
  });

  it("coalesces cancellation across jobs in the same scope", async () => {
    const { renderImage } = await client();
    const controller = new AbortController();
    const first = renderImage(request(), [], { signal: controller.signal, scope: "preview" });
    const second = renderImage(request(), [], { scope: "preview" });
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(workerState.workers[0].terminated).toBe(true);
  });
});
