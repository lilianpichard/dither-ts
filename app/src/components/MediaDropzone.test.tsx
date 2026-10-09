import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaDropzone } from "./MediaDropzone";

/**
 * No DOM is available to these tests, so what is checked here is what the
 * control advertises: one entry point, accepting both kinds. The routing itself
 * lives in mediaKindOf, which has its own suite, and the exclusivity it routes
 * into is checked in store.test.ts.
 */
describe("MediaDropzone", () => {
  it("offers both kinds in a single control", () => {
    const markup = renderToStaticMarkup(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain('accept="image/*,video/*"');
    expect(markup).toContain('aria-label="Drop image or video"');
    expect(markup).toContain("Drop image or video");
  });

  it("shows the loaded file name once something is loaded", () => {
    const markup = renderToStaticMarkup(<MediaDropzone onFile={() => {}} fileName="clip.mp4" />);
    expect(markup).toContain("clip.mp4");
    expect(markup).toContain("Click or drop to replace");
  });

  it("keeps a real button so it is reachable by keyboard", () => {
    const markup = renderToStaticMarkup(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain("<button");
    expect(markup).not.toContain('tabindex="0"');
  });

  it("hides its input from assistive tech, since the button names the action", () => {
    const markup = renderToStaticMarkup(<MediaDropzone onFile={() => {}} />);
    expect(markup).toContain('aria-hidden="true"');
  });
});
