import { describe, expect, it } from "vitest";
import { createIntl } from "react-intl";
import { describeRenderStatus, describeCanvasCaption, describeUncaught, isAbort } from "./status";
import { MESSAGES } from "./i18n/messages";
import type { Locale } from "./i18n/messages";
import type { Translate } from "./i18n";

/**
 * A real `t`, so ICU number formatting runs and the assertions are about what
 * the user reads rather than about the pattern.
 */
function tFor(locale: Locale): Translate {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  return ((id: string, values?: Record<string, string | number>) =>
    String(intl.formatMessage({ id } as never, values as never))) as unknown as Translate;
}

const t = tFor("en");

const idle = { hasSource: true, rendering: false, ms: null, previewScaled: false };

describe("render status", () => {
  it("names the empty state instead of leaving the line blank", () => {
    expect(describeRenderStatus({ ...idle, hasSource: false }, t)).toBe("No image");
  });

  it("announces progress and clears it once the result lands", () => {
    expect(describeRenderStatus({ ...idle, rendering: true }, t)).toBe("Rendering…");
    expect(describeRenderStatus(idle, t)).toBe("Ready");
    expect(describeRenderStatus({ ...idle, ms: 12.34 }, t)).toBe("Done in 12.3 ms");
  });

  it("mentions a scaled preview only when the preview was capped", () => {
    expect(describeRenderStatus({ ...idle, ms: 4, previewScaled: true }, t)).toBe(
      "Done in 4.0 ms · scaled",
    );
  });

  it("falls back to ready for a non-finite time", () => {
    expect(describeRenderStatus({ ...idle, ms: Number.NaN }, t)).toBe("Ready");
  });

  it("reads the same in the catalogue it was given", () => {
    // The string lives in the catalogue, so a language change moves the label.
    const fr = tFor("fr");
    expect(describeRenderStatus(idle, fr)).toBe(MESSAGES.fr["status.ready"]);
    expect(describeRenderStatus(idle, fr)).not.toBe(MESSAGES.en["status.ready"]);
    // A point becomes a comma, which is the point of formatting through ICU.
    expect(describeRenderStatus({ ...idle, ms: 12.34 }, fr)).toContain("12,3 ms");
  });
});

describe("canvas caption", () => {
  it("carries the geometry and the settings that produced it", () => {
    expect(
      describeCanvasCaption(
        { width: 1920, height: 1080, method: "Bayer 4x4", threshold: 128, pixelSize: 2 },
        t,
      ),
    ).toBe("1920×1080 · Bayer 4x4 · 128 · 2px");
  });

  it("keeps a pixel count readable in both languages", () => {
    // 3840 is a real export width. A grouping separator in a pixel count is
    // noise, so it is off for both, while decimals still follow the language.
    const caption = {
      width: 3840,
      height: 2160,
      method: "Bayer 4x4",
      threshold: 128,
      pixelSize: 2,
    };
    expect(describeCanvasCaption(caption, t)).toContain("3840×2160");
    expect(describeCanvasCaption(caption, tFor("fr"))).toContain("3840×2160");
  });
});

describe("uncaught failures", () => {
  it("say what went wrong, without repeating the prefix", () => {
    expect(describeUncaught(new Error("worker died"), t)).toBe("Something went wrong: worker died");
    expect(describeUncaught("plain string", t)).toBe("Something went wrong: plain string");
  });

  it("still say something when the reason carries no detail", () => {
    for (const reason of [undefined, null, "", {}]) {
      expect(describeUncaught(reason, t)).toBe("Something went wrong: an unknown error");
    }
  });

  it("stay quiet for a cancellation, which is not a failure", () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    expect(isAbort(abort)).toBe(true);
    expect(describeUncaught(abort, t)).toBe("");
    expect(isAbort(new Error("real failure"))).toBe(false);
    expect(isAbort("AbortError")).toBe(false);
  });

  it("read the same in French", () => {
    const fr = tFor("fr");
    expect(describeUncaught(new Error("boom"), fr)).toBe(
      MESSAGES.fr["error.boundary"].replace("{reason}", "boom"),
    );
  });
});
