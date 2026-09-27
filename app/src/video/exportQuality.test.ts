import { describe, expect, it } from "vitest";
import { avcCodecString, targetBitrate } from "./exportMp4";

describe("targetBitrate", () => {
  it("scales with frame rate once above the floor", () => {
    const slow = targetBitrate(1920, 1080, 12);
    const fast = targetBitrate(1920, 1080, 24);
    expect(fast / slow).toBeCloseTo(2);
  });

  it("scales with resolution once above the floor", () => {
    // Both sizes clear the 8 Mbps floor, so the ratio is exactly the pixel ratio.
    const hd = targetBitrate(1280, 720, 30);
    const fhd = targetBitrate(1920, 1080, 30);
    expect(fhd / hd).toBeCloseTo(2.25);
  });

  it("clamps below the floor rather than tracking the pixel count", () => {
    // 960x540 at 30fps works out to 7.8 Mbps unscaled, under the floor.
    expect(targetBitrate(960, 540, 30)).toBe(8_000_000);
  });

  it("gives a dithered 1080p clip enough bits to keep its dots", () => {
    // The old 0.12 bits-per-pixel figure was ~3 Mbps here and the dither came
    // back blurred. Half a bit per pixel is the floor for this content.
    expect(targetBitrate(1920, 1080, 24)).toBeGreaterThan(20_000_000);
  });

  it("keeps a tiny clip off an unusably low ceiling", () => {
    expect(targetBitrate(160, 120, 12)).toBe(8_000_000);
  });

  it("caps 4K so the file stays a reasonable size", () => {
    expect(targetBitrate(3840, 2160, 60)).toBe(80_000_000);
  });

  it("returns a whole number of bits per second", () => {
    for (const [w, h, fps] of [
      [1920, 1080, 12],
      [1280, 720, 25],
      [640, 480, 30],
    ]) {
      const value = targetBitrate(w, h, fps);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("avcCodecString", () => {
  it("keeps 1080p on the level it used before", () => {
    expect(avcCodecString(1920, 1080)).toBe("avc1.640028");
  });

  it("raises the level for 1440p, which 4.0 cannot carry", () => {
    expect(avcCodecString(2560, 1440)).not.toBe("avc1.640028");
    expect(avcCodecString(2560, 1440)).toMatch(/^avc1\.6400[0-9a-f]{2}$/);
  });

  it("raises the level again for 4K", () => {
    const uhd = avcCodecString(3840, 2160);
    expect(uhd).not.toBe(avcCodecString(2560, 1440));
    expect(uhd).toMatch(/^avc1\.6400[0-9a-f]{2}$/);
  });

  it("is ordered by level as the frame grows", () => {
    const level = (s: string) => parseInt(s.slice(-2), 16);
    const sd = level(avcCodecString(1280, 720));
    const fhd = level(avcCodecString(1920, 1080));
    const qhd = level(avcCodecString(2560, 1440));
    const uhd = level(avcCodecString(3840, 2160));
    expect(fhd).toBeGreaterThanOrEqual(sd);
    expect(qhd).toBeGreaterThan(fhd);
    expect(uhd).toBeGreaterThan(qhd);
  });
});
