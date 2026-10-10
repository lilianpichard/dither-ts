import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntl } from "react-intl";
import { browserAudioEnv, describeAudioStatus, probeAudioCapture } from "./audio";
import { MESSAGES } from "../i18n/messages";
import type { Translate } from "../i18n";

/** A real `t`, so the wording under test is the wording the user reads. */
function tFor(locale: "en" | "fr" = "en"): Translate {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  return ((id: string, values?: Record<string, string | number>) =>
    String(intl.formatMessage({ id }, values))) as unknown as Translate;
}

/** The English translator, and a helper for the other language. */
const t = tFor();
const tFr = (): Translate => tFor("fr");

const NOISY_ENV = { AudioEncoder: () => {}, captureStream: () => {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio capability probe", () => {
  it("reports support when every capture API is present", () => {
    const capability = probeAudioCapture(NOISY_ENV);
    expect(capability.supported).toBe(true);
    expect(capability.missing).toEqual([]);
  });

  it("names each missing API so the reason is visible", () => {
    expect(probeAudioCapture({}).missing).toEqual(["AudioEncoder", "media capture stream"]);
    expect(probeAudioCapture({}).supported).toBe(false);
  });

  it("rejects present-but-not-callable globals", () => {
    const capability = probeAudioCapture({ AudioEncoder: {}, captureStream: 42 });
    expect(capability.supported).toBe(false);
    expect(capability.missing).toHaveLength(2);
  });

  it("reports a partial environment as unsupported", () => {
    const capability = probeAudioCapture({ ...NOISY_ENV, AudioEncoder: undefined });
    expect(capability.supported).toBe(false);
    expect(capability.missing).toEqual(["AudioEncoder"]);
  });

  it("does not require getUserMedia, which only opens input devices", () => {
    const env = { ...NOISY_ENV, getUserMedia: undefined } as Record<string, unknown>;
    expect(probeAudioCapture(env).supported).toBe(true);
  });

  it("finds nothing outside a browser window", () => {
    vi.stubGlobal("window", undefined);
    expect(probeAudioCapture(browserAudioEnv()).supported).toBe(false);
  });

  it("reads the real window when there is one", () => {
    vi.stubGlobal("window", {
      AudioEncoder: () => {},
      HTMLMediaElement: { prototype: { captureStream: () => {} } },
      navigator: {},
    });
    expect(probeAudioCapture(browserAudioEnv()).supported).toBe(true);
  });
});

describe("audio status wording", () => {
  it("always says the export is video-only", () => {
    for (const capability of [probeAudioCapture({}), probeAudioCapture(NOISY_ENV)]) {
      expect(describeAudioStatus(capability, t)).toContain("Video-only export");
    }
  });

  it("never claims audio survives the export", () => {
    for (const capability of [probeAudioCapture({}), probeAudioCapture(NOISY_ENV)]) {
      const text = describeAudioStatus(capability, t).toLowerCase();
      expect(text).not.toMatch(/audio (is )?(preserved|kept|retained|included)/);
      expect(text).not.toMatch(/with audio/);
    }
  });

  it("explains a missing API rather than hiding it", () => {
    expect(describeAudioStatus(probeAudioCapture({}), t)).toContain("AudioEncoder");
    expect(describeAudioStatus(probeAudioCapture({}), t)).toContain("unavailable");
  });

  it("admits that present APIs still are not muxed", () => {
    expect(describeAudioStatus(probeAudioCapture(NOISY_ENV), t)).toContain(
      "no audio track is muxed",
    );
  });

  it("reads the same in French", () => {
    // The missing API names are proper nouns and stay as they are; the sentence
    // around them comes from the catalogue.
    const text = describeAudioStatus(probeAudioCapture({}), tFr());
    expect(text).toContain("AudioEncoder");
    expect(text).not.toContain("Video-only export");
  });
});
