import { beforeEach, describe, expect, it } from "vitest";
import { useApp, type ImageSource, type RenderResult } from "./store";
import { HISTORY_LIMIT } from "./history";
import type { RGB } from "../../src/index.js";

type SplitState = ReturnType<typeof useApp.getState> & {
  preview: RenderResult | null;
  setPreview: (result: RenderResult | null) => void;
};

const mediaFrame = () => ({
  display: { width: 1, height: 1, pixels: new ArrayBuffer(4) },
  compare: { width: 1, height: 1, pixels: new ArrayBuffer(4) },
  geometry: { width: 1, height: 1, pixels: new ArrayBuffer(4) },
  clipKey: "clip",
});

const source: ImageSource = {
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
  name: "test.png",
};

const finalResult: RenderResult = {
  width: 1,
  height: 1,
  pixels: new ArrayBuffer(4),
  ms: 2,
  jobId: 1,
};

const partialResult: RenderResult = {
  ...finalResult,
  jobId: 2,
  partial: true,
};

function state(): SplitState {
  return useApp.getState() as SplitState;
}

function reset(): void {
  useApp.setState({
    source: null,
    params: {
      method: "Floyd-Steinberg",
      threshold: 128,
      palette: "GameBoy",
      color: false,
      pixelSize: 1,
    },
    effects: [],
    operations: {},
    result: null,
    preview: null,
    rendering: false,
    previewScaled: false,
    past: [],
    future: [],
    clearSeq: 0,
  });
}

beforeEach(reset);

describe("render store transitions", () => {
  it("keeps partial frames in preview without replacing the final result", () => {
    state().setResult(finalResult);
    state().setPreview(partialResult);
    expect(state().result).toEqual(finalResult);
    expect(state().preview).toEqual(partialResult);
  });

  it("clears preview and rendering when a final result arrives", () => {
    state().setRendering(true);
    state().setPreview(partialResult);
    state().setResult(finalResult);
    expect(state().result).toEqual(finalResult);
    expect(state().preview).toBeNull();
    expect(state().rendering).toBe(false);
  });

  it("invalidates final results for source, parameter, and effect changes", () => {
    state().setResult(finalResult);
    state().setParams({ threshold: 100 });
    expect(state().result).toBeNull();

    state().setResult(finalResult);
    state().addEffect("blur");
    expect(state().result).toBeNull();

    state().setResult(finalResult);
    state().setSource(source);
    expect(state().result).toBeNull();
  });

  it("invalidates the result when operations change", () => {
    state().setResult(finalResult);
    state().setOperations({ invert: true });
    expect(state().result).toBeNull();
  });
});

describe("operations state", () => {
  it("starts at identity and keeps only bounded values", () => {
    expect(state().operations).toEqual({});
    state().setOperations({ brightness: 4, hue: 900, rotate: 90, invert: true });
    state().setOperations({ contrast: 2 });
    expect(state().operations).toEqual({
      brightness: 1,
      contrast: 1,
      hue: 180,
      rotate: 90,
      invert: true,
    });
  });

  it("merges patches and clears fields set to undefined", () => {
    state().setOperations({ invert: true, rotate: 90 });
    state().setOperations({ rotate: undefined });
    expect(state().operations).toEqual({ invert: true });
  });

  it("resets back to identity", () => {
    state().setOperations({ crop: { x: 0, y: 0, width: 4, height: 4 } });
    state().resetOperations();
    expect(state().operations).toEqual({});
  });

  it("accepts operations alongside params in one step", () => {
    state().setParams({ threshold: 64 }, { saturation: -1 });
    expect(state().params.threshold).toBe(64);
    expect(state().operations).toEqual({ saturation: -1 });
  });

  it("replaces the whole operation set when params carry one", () => {
    state().setOperations({ invert: true, rotate: 90 });
    state().setParams({ threshold: 64 }, { hue: 30 });
    expect(state().operations).toEqual({ hue: 30 });
  });

  it("leaves operations alone when params carry none", () => {
    state().setOperations({ invert: true });
    state().setParams({ threshold: 64 });
    expect(state().operations).toEqual({ invert: true });
  });
});

describe("operations follow the source frame", () => {
  it("refits a crop that does not fit the current source", () => {
    state().setSource({ ...source, width: 40, height: 30 });
    state().setOperations({ crop: { x: 90, y: 80, width: 100, height: 100 }, invert: true });
    expect(state().operations).toEqual({
      crop: { x: 39, y: 29, width: 1, height: 1 },
      invert: true,
    });
  });

  it("refits a crop an operation patch keeps while editing another field", () => {
    state().setSource({ ...source, width: 40, height: 30 });
    state().setOperations({ crop: { x: 0, y: 0, width: 20, height: 20 } });
    state().setOperations({ brightness: 0.5 });
    expect(state().operations).toEqual({
      crop: { x: 0, y: 0, width: 20, height: 20 },
      brightness: 0.5,
    });
  });

  it("refits a crop a preset brings from another image", () => {
    state().setSource({ ...source, width: 40, height: 30 });
    state().setParams({ threshold: 64 }, { crop: { x: 100, y: 100, width: 200, height: 200 } });
    expect(state().operations).toEqual({ crop: { x: 39, y: 29, width: 1, height: 1 } });
  });

  it("drops a crop while no frame is loaded", () => {
    state().setOperations({ crop: { x: 0, y: 0, width: 20, height: 20 }, invert: true });
    expect(state().operations).toEqual({ invert: true });
  });

  it("refits a crop that no longer fits the new source", () => {
    state().setSource({ ...source, width: 40, height: 30 });
    state().setOperations({ crop: { x: 30, y: 20, width: 10, height: 10 } });
    state().setSource({ ...source, width: 8, height: 8 });
    expect(state().operations).toEqual({ crop: { x: 7, y: 7, width: 1, height: 1 } });
  });

  it("keeps a crop that still fits and drops it with the source", () => {
    state().setSource(source);
    state().setOperations({ crop: { x: 0, y: 0, width: 1, height: 1 }, invert: true });
    state().setSource({ ...source, width: 64, height: 64 });
    expect(state().operations).toEqual({ crop: { x: 0, y: 0, width: 1, height: 1 }, invert: true });

    state().setSource(null);
    expect(state().operations).toEqual({ invert: true });
  });

  it("does not record a source change in history", () => {
    state().setOperations({ invert: true });
    state().setSource({ ...source, width: 8, height: 8 });
    expect(state().past).toHaveLength(1);
    state().undo();
    expect(state().operations).toEqual({});
  });

  it("refits a crop an undo restores onto a smaller frame", () => {
    state().setSource({ ...source, width: 64, height: 64 });
    state().setOperations({ crop: { x: 0, y: 0, width: 60, height: 60 } });
    state().setOperations({ invert: true });
    state().setSource({ ...source, width: 8, height: 8 });
    expect(state().operations?.crop).toEqual({ x: 0, y: 0, width: 8, height: 8 });

    state().undo();
    expect(state().operations?.crop).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    state().undo();
    expect(state().operations).toEqual({});
  });

  it("drops a restored crop when there is no frame", () => {
    state().setSource({ ...source, width: 64, height: 64 });
    state().setOperations({ crop: { x: 0, y: 0, width: 8, height: 8 } });
    state().setOperations({ invert: true });
    state().setSource(null);
    expect(state().operations).toEqual({ invert: true });
    // The snapshot only held a crop, so restoring it leaves nothing behind.
    state().undo();
    expect(state().operations).toEqual({});
  });
});

describe("store history", () => {
  it("undoes and redoes params and operations together", () => {
    state().setParams({ threshold: 64 });
    state().setOperations({ invert: true, hue: 45 });
    state().setOperations({ rotate: 90 });

    state().undo();
    expect(state().operations).toEqual({ invert: true, hue: 45 });
    state().undo();
    expect(state().operations).toEqual({});
    expect(state().params.threshold).toBe(64);
    state().undo();
    expect(state().params.threshold).toBe(128);
    expect(state().result).toBeNull();

    state().redo();
    expect(state().params.threshold).toBe(64);
    state().redo();
    expect(state().operations).toEqual({ invert: true, hue: 45 });
    state().redo();
    expect(state().operations).toEqual({ invert: true, hue: 45, rotate: 90 });
  });

  it("coalesces a slider drag into one undo step", () => {
    state().setParams({ threshold: 100 });
    state().setParams({ threshold: 120 });
    state().setParams({ threshold: 140 });
    expect(state().past).toHaveLength(1);
    state().undo();
    expect(state().params.threshold).toBe(128);
  });

  it("is a no-op at both ends and drops the redo branch on a new edit", () => {
    state().undo();
    expect(state().params.threshold).toBe(128);
    state().redo();
    expect(state().params.threshold).toBe(128);

    state().setParams({ threshold: 64 });
    state().undo();
    expect(state().future).toHaveLength(1);
    state().setParams({ pixelSize: 4 });
    expect(state().future).toHaveLength(0);
    expect(state().params.pixelSize).toBe(4);
  });

  it("caps undo depth at twenty entries", () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      state().setParams({ color: i % 2 === 0 });
    }
    expect(state().past).toHaveLength(HISTORY_LIMIT);
  });

  it("snapshots custom palettes by value", () => {
    const first: RGB[] = [
      [1, 2, 3],
      [250, 251, 252],
    ];
    state().setParams({ color: true, palette: first });
    state().setParams({ threshold: 64 }, { invert: true });
    const snapshot = state().past.at(-1)!;

    // Editing the live list must not rewrite the snapshot taken from it.
    first[0][0] = 99;
    expect(snapshot.params.palette).toEqual([
      [1, 2, 3],
      [250, 251, 252],
    ]);

    // Undo hands back a copy, so later edits cannot corrupt the stack either.
    state().undo();
    expect(state().params.palette).not.toBe(snapshot.params.palette);
    (state().params.palette as RGB[])[1][2] = 7;
    expect(snapshot.params.palette).toEqual([
      [1, 2, 3],
      [250, 251, 252],
    ]);
  });
});

describe("one source at a time", () => {
  it("drops the still when a clip takes the canvas", () => {
    state().setSource(source);
    state().showVideo(mediaFrame());

    expect(state().source).toBeNull();
    expect(state().media).toBe("video");
    expect(state().isVideo(state())).toBe(true);
  });

  it("drops the video frame when a still takes the canvas", () => {
    state().showVideo(mediaFrame());
    state().setSource(source);

    expect(state().videoPreview).toBeNull();
    expect(state().media).toBe("image");
    expect(state().isVideo(state())).toBe(false);
  });

  it("keeps whichever the user loaded last", () => {
    // The reported bug: an image was loaded, a clip was loaded, and opening the
    // video panel handed the canvas back. Neither can steal it now.
    state().setSource(source);
    state().showVideo(mediaFrame());
    state().setSource(source);
    state().showVideo(mediaFrame());
    expect(state().media).toBe("video");
    expect(state().source).toBeNull();
    expect(state().videoPreview).not.toBeNull();
  });

  it("clears the subject when the owner calls back with nothing", () => {
    state().showVideo(mediaFrame());
    state().showVideo(null);
    expect(state().media).toBeNull();
    expect(state().videoPreview).toBeNull();

    state().setSource(source);
    state().setSource(null);
    expect(state().media).toBeNull();
  });

  it("leaves the other kind's marker alone when it was never the owner", () => {
    // Clearing the video must not blank out an image that is already showing.
    state().setSource(source);
    state().showVideo(mediaFrame());
    state().showVideo(null);
    expect(state().media).toBeNull();
  });
});

describe("a video arriving from the shared picker", () => {
  it("hands the file to the timeline and clears itself", () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    state().loadVideo(file);
    expect(state().pendingVideo).toBe(file);
    state().loadVideo(null);
    expect(state().pendingVideo).toBeNull();
  });
});

describe("loading a video over a still", () => {
  it("drops the still as the file is handed over", () => {
    state().setSource(source);
    expect(state().media).toBe("image");
    // The picker routes a video by clearing the still first, so the canvas is
    // uncontested before the clip is even decoded.
    state().setSource(null);
    state().loadVideo(new File(["x"], "clip.mp4", { type: "video/mp4" }));
    expect(state().source).toBeNull();
    expect(state().media).toBeNull();
    state().showVideo(mediaFrame());
    expect(state().media).toBe("video");
    expect(state().isVideo(state())).toBe(true);
  });
});

describe("clearing the loaded media", () => {
  beforeEach(() => {
    useApp.setState({
      source,
      result: finalResult,
      videoPreview: mediaFrame(),
      media: "image",
      rendering: true,
      previewScaled: true,
    });
  });

  it("empties the canvas, whichever kind owned it", () => {
    useApp.getState().clearMedia();
    const next = useApp.getState();
    expect(next.source).toBeNull();
    expect(next.result).toBeNull();
    expect(next.videoPreview).toBeNull();
    expect(next.media).toBeNull();
    expect(next.rendering).toBe(false);
    expect(next.previewScaled).toBe(false);
  });

  it("leaves the settings alone, because a cleared canvas is not a reset", () => {
    // Clearing what was loaded is not the same as going back to defaults: the
    // method and the palette were chosen and survive.
    const params = useApp.getState().params;
    useApp.getState().clearMedia();
    expect(useApp.getState().params).toEqual(params);
  });

  it("clears a clip that owns the canvas too", () => {
    useApp.setState({ media: "video" });
    useApp.getState().clearMedia();
    expect(useApp.getState().videoPreview).toBeNull();
    expect(useApp.getState().media).toBeNull();
  });

  it("moves the counter, which is how the timeline drops its clip", () => {
    // The store owns the canvas and the timeline owns the clip; a counter is the
    // only thing the two share, so it has to move every time.
    expect(useApp.getState().clearSeq).toBe(0);
    useApp.getState().clearMedia();
    expect(useApp.getState().clearSeq).toBe(1);
    useApp.getState().clearMedia();
    expect(useApp.getState().clearSeq).toBe(2);
  });

  it("is idempotent on the state, but still tells the timeline", () => {
    // A second clear on an already empty canvas changes nothing, and the counter
    // still moves: the timeline has to be told even when there was nothing to
    // clear, or a clip left behind by the first would stay.
    useApp.getState().clearMedia();
    useApp.getState().clearMedia();
    const next = useApp.getState();
    expect(next.source).toBeNull();
    expect(next.result).toBeNull();
    expect(next.clearSeq).toBe(2);
  });
});
