import { describe, expect, it } from "vitest";
import { MEDIA_ACCEPT, mediaKindOf } from "./kind";

describe("mediaKindOf", () => {
  it("trusts a declared image type", () => {
    expect(mediaKindOf({ type: "image/png", name: "a.png" })).toBe("image");
    expect(mediaKindOf({ type: "image/jpeg", name: "a.jpg" })).toBe("image");
  });

  it("trusts a declared video type", () => {
    expect(mediaKindOf({ type: "video/mp4", name: "a.mp4" })).toBe("video");
    expect(mediaKindOf({ type: "video/quicktime", name: "a.mov" })).toBe("video");
  });

  it("falls back to the extension when the OS reported nothing", () => {
    // A dropped .mkv or .ogv arrives with an empty type often enough to matter.
    for (const name of ["clip.mkv", "clip.ogv", "clip.webm", "clip.avi", "clip.m4v"]) {
      expect(mediaKindOf({ type: "", name })).toBe("video");
    }
    for (const name of ["shot.png", "shot.PNG", "shot.webp", "shot.tif"]) {
      expect(mediaKindOf({ type: "", name })).toBe("image");
    }
  });

  it("puts an extension above a missing type but never above a real one", () => {
    // The type is what the decoder acts on, so it wins even when the name
    // disagrees, and a file with neither is refused rather than guessed.
    expect(mediaKindOf({ type: "image/png", name: "actually.mp4" })).toBe("image");
    expect(mediaKindOf({ type: "", name: "archive.zip" })).toBeNull();
    expect(mediaKindOf({ type: "application/pdf", name: "doc.pdf" })).toBeNull();
    expect(mediaKindOf({ type: "text/plain", name: "notes" })).toBeNull();
  });

  it("accepts a file with no extension at all when the type is declared", () => {
    expect(mediaKindOf({ type: "video/mp4", name: "clip" })).toBe("video");
  });

  it("offers both kinds to one control", () => {
    expect(MEDIA_ACCEPT).toBe("image/*,video/*");
  });
});
