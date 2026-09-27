import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { SLOW_OPERATION_MS, warnIfSlow } from "./slowOperation";

beforeEach(() => {
  vi.useFakeTimers();
  toastMock.info.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("warnIfSlow", () => {
  it("stays quiet when the operation finishes in time", () => {
    const done = warnIfSlow(1000, "slow");
    done();
    vi.advanceTimersByTime(5000);
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("warns once when the operation outlives the delay", () => {
    warnIfSlow(1000, "taking a while");
    vi.advanceTimersByTime(1000);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(toastMock.info).toHaveBeenCalledWith("taking a while");
  });

  it("does not warn again after the finish callback runs late", () => {
    const done = warnIfSlow(1000, "slow");
    vi.advanceTimersByTime(1000);
    done();
    vi.advanceTimersByTime(10_000);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it("has a sensible default delay", () => {
    expect(SLOW_OPERATION_MS).toBeGreaterThan(1000);
  });
});
