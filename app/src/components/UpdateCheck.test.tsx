import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider, createIntl } from "react-intl";
import { canUpdate, desktopBridge } from "../desktop/bridge";
import { MESSAGES } from "../i18n/messages";
import { UpdateCheck, updateLabel } from "./UpdateCheck";
import type { Translate } from "../i18n";

/**
 * A real `t`, so the ICU number formatting the labels rely on runs too. Without
 * it the skeleton syntax shows through as literal text.
 */
function tFor(locale: "en" | "fr" = "en"): Translate {
  const intl = createIntl({ locale, defaultLocale: "en", messages: MESSAGES[locale] });
  return ((id: string, values?: Record<string, string | number>) =>
    String(intl.formatMessage({ id }, values))) as unknown as Translate;
}

const t = tFor();

/** Wraps a component in the provider the hooks need. */
function withIntl(node: React.ReactNode): React.ReactElement {
  return (
    <IntlProvider locale="en" defaultLocale="en" messages={MESSAGES.en}>
      {node}
    </IntlProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateLabel", () => {
  it("names the version when one is waiting", () => {
    expect(updateLabel({ state: "available", version: "1.2.0" }, false, t)).toBe("Update 1.2.0");
  });

  it("says checking while a request is in flight", () => {
    expect(updateLabel(null, true, t)).toBe("Checking");
  });

  it("shows the percentage while a download runs", () => {
    expect(
      updateLabel({ state: "downloading", percent: 42, transferred: 1, total: 2 }, false, t),
    ).toBe("Downloading 42%");
  });

  it("asks for a restart once the download finished", () => {
    expect(updateLabel({ state: "ready", version: "1.2.0" }, false, t)).toBe("Restart to update");
  });

  it("stays quiet when there is nothing to report", () => {
    for (const status of [
      null,
      { state: "checking" } as const,
      { state: "current", version: "1.0.0" } as const,
      { state: "failed", message: "offline" } as const,
    ]) {
      expect(updateLabel(status, false, t)).toBeNull();
    }
  });
});

describe("UpdateCheck", () => {
  it("renders nothing on the web, where there is no feed", () => {
    vi.stubGlobal("window", {});
    expect(canUpdate()).toBe(false);
    expect(renderToStaticMarkup(withIntl(<UpdateCheck />))).toBe("");
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
    expect(renderToStaticMarkup(withIntl(<UpdateCheck />))).toBe("");
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
    const markup = renderToStaticMarkup(withIntl(<UpdateCheck />));
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
