import { describe, expect, it } from "vitest";
import { describeAge } from "./PresetsPanel";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The preset card shows a relative stamp, and entries saved before the field
// existed have none, so the helper has to survive a missing value.
describe("describeAge", () => {
  it("reads as just now inside the first minute", () => {
    expect(describeAge(NOW, NOW)).toBe("just now");
    expect(describeAge(NOW - MINUTE + 1, NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(describeAge(NOW - 12 * MINUTE, NOW)).toBe("12m ago");
    expect(describeAge(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(describeAge(NOW - 5 * DAY, NOW)).toBe("5d ago");
  });

  it("falls back for entries with no usable stamp", () => {
    expect(describeAge(undefined, NOW)).toBe("Saved");
    expect(describeAge(Number.NaN, NOW)).toBe("Saved");
  });

  it("never reports a negative age from a clock that moved backwards", () => {
    expect(describeAge(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });
});
