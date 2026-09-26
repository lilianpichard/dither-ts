import { describe, expect, it } from "vitest";
import { announceProgress, ANNOUNCE_STEP } from "./progress";

const batch = { label: "Batch", running: true, done: 0, total: 8 };

describe("progress announcements", () => {
  it("announces the start once and then only on milestones", () => {
    expect(announceProgress(batch)).toBe("Batch started");
    // Still under the first milestone bucket: same text, so no re-announce.
    expect(announceProgress({ ...batch, done: 1 })).toBe("Batch started");
    expect(announceProgress({ ...batch, done: 2 })).toBe(`Batch ${ANNOUNCE_STEP}%`);
    expect(announceProgress({ ...batch, done: 3 })).toBe(`Batch ${ANNOUNCE_STEP}%`);
    expect(announceProgress({ ...batch, done: 4 })).toBe(`Batch ${ANNOUNCE_STEP * 2}%`);
    expect(announceProgress({ ...batch, done: 8 })).toBe("Batch 100%");
  });

  it("stays quiet when the job is not running", () => {
    expect(announceProgress({ ...batch, running: false, done: 8 })).toBe("");
  });

  it("treats an unknown total as the start milestone", () => {
    expect(announceProgress({ ...batch, total: 0, done: 3 })).toBe("Batch started");
    expect(announceProgress({ ...batch, total: 8, done: Number.NaN })).toBe("Batch started");
  });

  it("clamps a total that is outrun by done", () => {
    expect(announceProgress({ ...batch, done: 99 })).toBe("Batch 100%");
    expect(announceProgress({ ...batch, done: -2 })).toBe("Batch started");
  });
});
