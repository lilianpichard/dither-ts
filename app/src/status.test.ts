import { describe, expect, it } from "vitest";
import { describeRenderStatus, describeUncaught, isAbort, RENDERING_TEXT } from "./status";

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

describe("uncaught failures", () => {
  it("say what went wrong, without repeating the prefix", () => {
    expect(describeUncaught(new Error("worker died"))).toBe("Unexpected error: worker died");
    expect(describeUncaught("plain string")).toBe("Unexpected error: plain string");
  });

  it("still say something when the reason carries no detail", () => {
    for (const reason of [undefined, null, "", {}]) {
      expect(describeUncaught(reason)).toBe("Unexpected error");
    }
  });

  it("stay quiet for a cancellation, which is not a failure", () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    expect(isAbort(abort)).toBe(true);
    expect(describeUncaught(abort)).toBe("");
    expect(isAbort(new Error("real failure"))).toBe(false);
    expect(isAbort("AbortError")).toBe(false);
  });
});
