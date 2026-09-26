import { afterEach, describe, expect, it, vi } from "vitest";
import { browserAudioEnv, describeAudioStatus, probeAudioCapture } from "./audio";

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
      expect(describeAudioStatus(capability)).toContain("Video-only export");
    }
  });

  it("never claims audio survives the export", () => {
    for (const capability of [probeAudioCapture({}), probeAudioCapture(NOISY_ENV)]) {
      const text = describeAudioStatus(capability).toLowerCase();
      expect(text).not.toMatch(/audio (is )?(preserved|kept|retained|included)/);
      expect(text).not.toMatch(/with audio/);
    }
  });

  it("explains a missing API rather than hiding it", () => {
    expect(describeAudioStatus(probeAudioCapture({}))).toContain("AudioEncoder");
    expect(describeAudioStatus(probeAudioCapture({}))).toContain("unavailable");
  });

  it("admits that present APIs still are not muxed", () => {
    expect(describeAudioStatus(probeAudioCapture(NOISY_ENV))).toContain("no audio track is muxed");
  });
});
