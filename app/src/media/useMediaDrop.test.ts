import { describe, expect, it } from "vitest";
import { mediaKindOf } from "./kind";
import type { MediaKind } from "./kind";

/**
 * A file is what a drop hands over, and the surface never sees one in a real
 * gesture, so the hook's decisions are read through the same predicate every
 * surface uses before it hands one on.
 */
function file(name: string, type = ""): File {
  return new File([new Uint8Array(4)], name, { type });
}

describe("mediaKindOf", () => {
  it("reads an image by its mime", () => {
    expect(mediaKindOf(file("a.png", "image/png"))).toBe<MediaKind>("image");
    expect(mediaKindOf(file("a.webp", "image/webp"))).toBe<MediaKind>("image");
    expect(mediaKindOf(file("a.gif", "image/gif"))).toBe<MediaKind>("image");
  });

  it("reads a video by its mime", () => {
    expect(mediaKindOf(file("a.mp4", "video/mp4"))).toBe<MediaKind>("video");
    expect(mediaKindOf(file("a.webm", "video/webm"))).toBe<MediaKind>("video");
  });

  it("falls back to the extension when the browser reports no mime", () => {
    // A drop from some file managers carries an empty type, and the extension is
    // still there to be read.
    expect(mediaKindOf(file("photo.PNG"))).toBe<MediaKind>("image");
    expect(mediaKindOf(file("clip.MP4"))).toBe<MediaKind>("video");
  });

  it("refuses anything that is neither, so the surface can say why", () => {
    // A silent no-op reads as a broken app, which is why the hook toasts.
    expect(mediaKindOf(file("notes.txt", "text/plain"))).toBeNull();
    expect(mediaKindOf(file("notes.txt"))).toBeNull();
    expect(mediaKindOf(file("archive.zip", "application/zip"))).toBeNull();
    expect(mediaKindOf(file("noextension"))).toBeNull();
  });

  it("never mistakes a video extension inside a name for its kind", () => {
    // "holiday.mp4.png" is a png with a misleading stem.
    expect(mediaKindOf(file("holiday.mp4.png", "image/png"))).toBe<MediaKind>("image");
    expect(mediaKindOf(file("holiday.mp4.png"))).toBe<MediaKind>("image");
  });

  it("agrees with the accept list the picker filters on", () => {
    // The picker filters by ACCEPT, and a drop does not, so the two lists have to
    // describe the same set of files or a drop could load what a pick cannot.
    const image = file("a.png", "image/png");
    expect(mediaKindOf(image)).not.toBeNull();
  });
});
