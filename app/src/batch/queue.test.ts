import { describe, expect, it } from "vitest";
import {
  batchOutcome,
  estimateEtaMs,
  formatEta,
  isSettled,
  settleRemaining,
  settledCount,
  tally,
  type BatchItem,
  type BatchStatus,
} from "./queue";

const ALL_DONE: BatchStatus[] = ["done", "done", "done"];

describe("settled counts", () => {
  it("treats done, error and skipped as final", () => {
    expect(isSettled("done")).toBe(true);
    expect(isSettled("error")).toBe(true);
    expect(isSettled("skipped")).toBe(true);
    expect(isSettled("queued")).toBe(false);
    expect(isSettled("working")).toBe(false);
  });

  it("never lets the progress bar go past the total", () => {
    expect(settledCount(["done", "error", "working", "queued"])).toBe(2);
    expect(settledCount([])).toBe(0);
  });
});

describe("tally", () => {
  it("counts each status once", () => {
    expect(tally(["done", "error", "skipped", "queued"])).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      skipped: 1,
      cancelled: false,
    });
  });

  it("carries the cancel flag through", () => {
    expect(tally(["done"], true).cancelled).toBe(true);
  });
});

describe("estimateEtaMs", () => {
  it("needs two samples before it will guess", () => {
    expect(estimateEtaMs([], 10)).toBeNull();
    expect(estimateEtaMs([1200], 10)).toBeNull();
  });

  it("needs work left to do", () => {
    expect(estimateEtaMs([1000, 1000], 0)).toBeNull();
    expect(estimateEtaMs([1000, 1000], -1)).toBeNull();
  });

  it("multiplies the mean sample by the remaining files", () => {
    expect(estimateEtaMs([1000, 3000], 4)).toBe(8000);
    expect(estimateEtaMs([500, 500, 500], 3)).toBe(1500);
  });

  it("ignores junk samples rather than poisoning the mean", () => {
    expect(estimateEtaMs([1000, Number.NaN, 3000], 2)).toBe(4000);
    expect(estimateEtaMs([-5, 1000, 3000], 2)).toBe(4000);
  });

  it("would rather print nothing than guess from one good sample", () => {
    expect(estimateEtaMs([1000, -5], 1)).toBeNull();
    expect(estimateEtaMs([1000, Number.NaN], 1)).toBeNull();
  });
});

describe("settleRemaining", () => {
  const entries = (statuses: BatchStatus[]): BatchItem[] =>
    statuses.map((status, i) => ({ name: `f${i}.png`, status }));

  it("skips everything from the cut-off that had not settled", () => {
    const out = settleRemaining(entries(["done", "working", "queued", "queued"]), 1);
    expect(out.map((it) => it.status)).toEqual(["done", "skipped", "skipped", "skipped"]);
  });

  it("leaves what already finished alone", () => {
    const out = settleRemaining(entries(["done", "error", "skipped"]), 0);
    expect(out.map((it) => it.status)).toEqual(["done", "error", "skipped"]);
  });

  it("counts a file whose write already resolved as written, not skipped", () => {
    // Cancelling after the write landed must not take the file back off the list.
    const out = settleRemaining(entries(["done", "done", "working"]), 2);
    expect(
      tally(
        out.map((it) => it.status),
        true,
      ),
    ).toEqual({
      total: 3,
      done: 2,
      failed: 0,
      skipped: 1,
      cancelled: true,
    });
  });

  it("does nothing when the run finished every file", () => {
    const done = entries(["done", "done"]);
    expect(settleRemaining(done, 2)).toEqual(done);
  });

  it("keeps the names it was given", () => {
    const out = settleRemaining(entries(["queued", "queued"]), 0);
    expect(out.map((it) => it.name)).toEqual(["f0.png", "f1.png"]);
  });

  it("leaves the input alone", () => {
    const before = entries(["done", "working"]);
    settleRemaining(before, 1);
    expect(before[1].status).toBe("working");
  });
});

describe("formatEta", () => {
  it("says nothing when there is no estimate", () => {
    expect(formatEta(null)).toBe("");
    expect(formatEta(0)).toBe("");
    expect(formatEta(Number.NaN)).toBe("");
    expect(formatEta(-1)).toBe("");
  });

  it("switches units once and stays stable", () => {
    expect(formatEta(1)).toBe("about 1s left");
    expect(formatEta(59_400)).toBe("about 1m left");
    expect(formatEta(90_000)).toBe("about 1m 30s left");
  });
});

describe("batchOutcome", () => {
  it("reports a clean run as a success", () => {
    expect(batchOutcome(tally(ALL_DONE))).toEqual({
      tone: "success",
      message: "Batch finished: 3 images written",
    });
  });

  it("never reports a run with failures as a success", () => {
    const outcome = batchOutcome(tally(["done", "error"]));
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toBe("Batch finished with 1 error: 1 of 2 written");
  });

  it("counts several failures in the plural", () => {
    expect(batchOutcome(tally(["error", "error", "error"])).message).toBe(
      "Batch finished with 3 errors: 0 of 3 written",
    );
  });

  it("reports a cancelled run as stopped, not finished", () => {
    const outcome = batchOutcome(tally(["done", "skipped", "skipped"], true));
    expect(outcome.tone).toBe("info");
    expect(outcome.message).toBe("Batch stopped: 1 image written, 2 skipped");
  });

  it("mentions failures in a cancelled run too", () => {
    const outcome = batchOutcome(tally(["done", "error", "skipped"], true));
    expect(outcome.tone).toBe("info");
    expect(outcome.message).toBe("Batch stopped: 1 image written, 1 failed, 1 skipped");
  });

  it("does not pad a clean cancelled run with zero counts", () => {
    expect(batchOutcome(tally(["done", "done"], true)).message).toBe(
      "Batch stopped: 2 images written",
    );
  });

  it("has nothing to say about an empty batch", () => {
    expect(batchOutcome(tally([]))).toEqual({ tone: "info", message: "No images to process" });
  });
});
