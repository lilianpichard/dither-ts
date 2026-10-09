import { describe, expect, it, vi } from "vitest";
import { mediaRejection, routeMedia } from "./route";
import { mediaKindOf } from "./kind";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1])], name, { type });
}

function actions() {
  return { setSource: vi.fn(), loadVideo: vi.fn() };
}

describe("routeMedia", () => {
  it("sends a video through after clearing the still", () => {
    const calls = actions();
    routeMedia(file("clip.mp4", "video/mp4"), "video", calls);
    // The order matters: the still goes first, so the canvas is uncontested
    // before the clip is decoded and there is never a moment with both live.
    expect(calls.setSource).toHaveBeenCalledWith(null);
    expect(calls.loadVideo).toHaveBeenCalledOnce();
    const order = calls.setSource.mock.invocationCallOrder[0];
    expect(order).toBeLessThan(calls.loadVideo.mock.invocationCallOrder[0]);
  });

  it("sends an image through without touching the video", () => {
    const calls = actions();
    routeMedia(file("shot.png", "image/png"), "image", calls);
    expect(calls.loadVideo).not.toHaveBeenCalled();
    // setSource still through the store, which is what hands the canvas over.
    expect(calls.setSource).not.toHaveBeenCalled();
  });

  it("routes by the detected kind, not by what the name suggests", () => {
    // The reported failure was a video arriving where an image was expected, so
    // the detection is the only authority here.
    const calls = actions();
    const mislabelled = file("photo.png", "video/mp4");
    routeMedia(mislabelled, mediaKindOf(mislabelled)!, calls);
    expect(calls.setSource).toHaveBeenCalledWith(null);
    expect(calls.loadVideo).toHaveBeenCalledOnce();
    expect(calls.loadVideo.mock.calls[0][0]).toBe(mislabelled);
  });
});

describe("mediaRejection", () => {
  it("names what cannot be used", () => {
    expect(mediaRejection(file("doc.pdf", "application/pdf"))).toBe(
      "doc.pdf is not an image or a video.",
    );
    expect(mediaRejection(file("shot.png", "image/png"))).toBeNull();
    expect(mediaRejection(file("clip.mp4", "video/mp4"))).toBeNull();
  });

  it("handles a file with no name", () => {
    expect(mediaRejection(file("", "application/zip"))).toBe(
      "That file is not an image or a video.",
    );
  });
});
