import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canUpdate, desktopBridge } from "../desktop/bridge";
import { UpdateCheck, updateLabel } from "./UpdateCheck";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateLabel", () => {
  it("names the version when one is waiting", () => {
    expect(updateLabel({ state: "available", version: "1.2.0" }, false)).toBe("Update 1.2.0");
  });

  it("says checking while a request is in flight", () => {
    expect(updateLabel(null, true)).toBe("Checking");
  });

  it("shows the percentage while a download runs", () => {
    expect(
      updateLabel({ state: "downloading", percent: 42, transferred: 1, total: 2 }, false),
    ).toBe("Downloading 42%");
  });

  it("asks for a restart once the download finished", () => {
    expect(updateLabel({ state: "ready", version: "1.2.0" }, false)).toBe("Restart to update");
  });

  it("stays quiet when there is nothing to report", () => {
    for (const status of [
      null,
      { state: "checking" } as const,
      { state: "current", version: "1.0.0" } as const,
      { state: "failed", message: "offline" } as const,
    ]) {
      expect(updateLabel(status, false)).toBeNull();
    }
  });
});

describe("UpdateCheck", () => {
  it("renders nothing on the web, where there is no feed", () => {
    vi.stubGlobal("window", {});
    expect(canUpdate()).toBe(false);
    expect(renderToStaticMarkup(<UpdateCheck />)).toBe("");
  });

  it("renders nothing on a dev shell that exposes no feed", () => {
    vi.stubGlobal("window", {
      ditherDesktop: {
        versions: {},
        open: () => {},
        pickDirectory: () => {},
        save: () => {},
      },
    });
    expect(canUpdate()).toBe(false);
    expect(renderToStaticMarkup(<UpdateCheck />)).toBe("");
  });

  it("renders one labelled button when the shell has a feed", () => {
    vi.stubGlobal("window", {
      ditherDesktop: {
        versions: {},
        open: () => {},
        pickDirectory: () => {},
        save: () => {},
        checkUpdate: () => {},
        onUpdate: () => () => {},
      },
    });
    expect(canUpdate()).toBe(true);
    const markup = renderToStaticMarkup(<UpdateCheck />);
    expect(markup).toContain('aria-label="Check for updates"');
    expect(markup).toContain('title="Check for updates"');
  });

  it("treats a non-callable feed as no feed", () => {
    vi.stubGlobal("window", {
      ditherDesktop: {
        versions: {},
        open: () => {},
        pickDirectory: () => {},
        save: () => {},
        checkUpdate: "nope",
      },
    });
    expect(desktopBridge()).not.toBeNull();
    expect(canUpdate()).toBe(false);
  });
});
