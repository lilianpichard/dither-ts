import { describe, expect, it } from "vitest";
import { describeRenderStatus, RENDERING_TEXT } from "./status";

const idle = { hasSource: true, rendering: false, ms: null, previewScaled: false };

describe("render status", () => {
  it("names the empty state instead of leaving the line blank", () => {
    expect(describeRenderStatus({ ...idle, hasSource: false })).toBe("No image");
  });

  it("announces progress and clears it once the result lands", () => {
    expect(describeRenderStatus({ ...idle, rendering: true })).toBe(RENDERING_TEXT);
    expect(describeRenderStatus(idle)).toBe("Ready");
    expect(describeRenderStatus({ ...idle, ms: 12.34 })).toBe("Done in 12.3 ms");
  });

  it("mentions a scaled preview only when the preview was capped", () => {
    expect(describeRenderStatus({ ...idle, ms: 4, previewScaled: true })).toBe(
      "Done in 4.0 ms · scaled",
    );
  });

  it("falls back to ready for a non-finite time", () => {
    expect(describeRenderStatus({ ...idle, ms: Number.NaN })).toBe("Ready");
  });
});
