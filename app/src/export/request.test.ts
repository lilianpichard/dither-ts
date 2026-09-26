import { describe, expect, it } from "vitest";
import {
  buildExportRenderRequest,
  canExport,
  nextExportProgress,
  runExportAction,
} from "./request";
import type { DitherParams, ImageSource, RenderResult, StackedEffect } from "../store";

const params: DitherParams = {
  method: "Floyd-Steinberg",
  threshold: 128,
  palette: "B&W",
  color: false,
  pixelSize: 1,
};

const source: ImageSource = {
  width: 2048,
  height: 1536,
  pixels: new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer,
  name: "source.png",
};

const effects: StackedEffect[] = [
  { key: "blur-1", type: "blur", params: { radius: 2 }, enabled: true },
];

const result: RenderResult = {
  width: 720,
  height: 540,
  pixels: new Uint8Array(720 * 540 * 4).buffer as ArrayBuffer,
  ms: 4,
  jobId: 1,
};

describe("export render requests", () => {
  it("keeps the original source dimensions and pixels for export", () => {
    const request = buildExportRenderRequest(source, params, effects);

    expect(request.width).toBe(source.width);
    expect(request.height).toBe(source.height);
    expect(request.pixels).not.toBe(source.pixels);
    expect(new Uint8Array(request.pixels)).toEqual(new Uint8Array(source.pixels));
    expect(request.effects).toEqual([{ type: "blur", params: { radius: 2 }, enabled: true }]);
  });

  it("carries operations and clamps the crop to the exported frame", () => {
    const request = buildExportRenderRequest(source, params, effects, {
      crop: { x: 2000, y: 1500, width: 500, height: 500 },
      rotate: 270,
      invert: true,
    });

    expect(request.operations).toEqual({
      crop: { x: 2000, y: 1500, width: 48, height: 36 },
      rotate: 270,
      invert: true,
    });
  });

  it("omits identity operations so the worker skips the frame copy", () => {
    expect(buildExportRenderRequest(source, params, effects).operations).toBeUndefined();
    expect(
      buildExportRenderRequest(source, params, effects, { brightness: 0, invert: false })
        .operations,
    ).toBeUndefined();
  });
});

describe("export actions", () => {
  it("passes the signal and does not complete after an async abort", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    let downloaded = false;
    const completed = await runExportAction("image", controller.signal, async (_image, signal) => {
      receivedSignal = signal;
      await Promise.resolve();
      controller.abort();
      if (!signal.aborted) downloaded = true;
    });
    expect(receivedSignal).toBe(controller.signal);
    expect(downloaded).toBe(false);
    expect(completed).toBe(false);
  });
});

describe("export progress", () => {
  it("keeps progress monotonic and finishes at 100", () => {
    const updates = [
      { rowsDone: 1, totalRows: 4 },
      { rowsDone: 2, totalRows: 4 },
      { rowsDone: 1, totalRows: 4 },
      { rowsDone: 4, totalRows: 4 },
    ];
    const values: number[] = [];
    for (const update of updates) {
      values.push(nextExportProgress(update.rowsDone, update.totalRows, values.at(-1) ?? 0));
    }
    expect(values).toEqual([25, 50, 50, 100]);
  });
});

describe("export gating", () => {
  it("allows export only for a final result when no render is active", () => {
    expect(canExport(result, false, false)).toBe(true);
    expect(canExport(null, false, false)).toBe(false);
    expect(canExport({ ...result, partial: true }, false, false)).toBe(false);
  });

  it("disables export while preview rendering or exporting", () => {
    expect(canExport(result, true, false)).toBe(false);
    expect(canExport(result, false, true)).toBe(false);
  });
});
